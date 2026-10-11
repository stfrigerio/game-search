import { CONTENT_FILTERS, FEATURES, LANGUAGE_BY_CODE, LANGUAGES } from "../../shared/features.ts";
import type { SearchQuery } from "../../shared/query.ts";
import type { CatalogStatus, Game, GameDetailResponse, GameSummary, MetaResponse, SearchResponse } from "../../shared/types.ts";
import { featureKeysOf, languagesOf, summarize } from "../derive.ts";
import { titleKey } from "../merge.ts";
import { db } from "./pool.ts";
import { fullGame, rowToGame, rowToSummary, SUMMARY_COLUMNS, type GameRow } from "./rows.ts";
import { LIVE } from "./schema.ts";

export const PAGE_SIZE = 30;
const FACET_COUNT = 40;
const G = `${LIVE}.games`;

// ---------------------------------------------------------------------------
// Catalogue metadata, cached briefly: tag ids are needed to build every query.

interface CatalogInfo {
  tags: { id: number; name: string; count: number }[];
  tagIds: Map<string, number>;
  updatedAt: string | null;
  currency: string;
  storeCounts: Record<string, number>;
  gameCount: number;
  loadedAt: number;
}

let info: Promise<CatalogInfo> | null = null;

async function loadInfo(): Promise<CatalogInfo> {
  const [tags, meta, count] = await Promise.all([
    db().query<{ id: number; name: string; count: number }>(`SELECT id, name, count FROM ${LIVE}.tags ORDER BY count DESC`),
    db().query<{ key: string; value: unknown }>(`SELECT key, value FROM ${LIVE}.meta`),
    // The planner's estimate is plenty for "195K games" and avoids a full scan.
    db().query<{ n: number }>(`SELECT reltuples::bigint AS n FROM pg_class WHERE oid = '${G}'::regclass`),
  ]);
  const m = Object.fromEntries(meta.rows.map((r) => [r.key, r.value]));
  return {
    tags: tags.rows,
    tagIds: new Map(tags.rows.map((t) => [t.name.toLowerCase(), t.id])),
    updatedAt: (m.updated_at as string) ?? null,
    currency: (m.currency as string) ?? "USD",
    storeCounts: (m.store_counts as Record<string, number>) ?? {},
    gameCount: Math.max(0, Number(count.rows[0]?.n ?? 0)),
    loadedAt: Date.now(),
  };
}

/** Forget cached catalogue info (after loading a catalogue in tests). */
export function resetCatalogCache() {
  info = null;
}

/** Catalogue info, refreshed at most once a minute (a crawl swaps the whole catalogue). */
async function catalogInfo(): Promise<CatalogInfo> {
  const current = info ? await info.catch(() => null) : null;
  if (!current || Date.now() - current.loadedAt > 60_000) {
    info = loadInfo();
    info.catch(() => (info = null));
    return info;
  }
  return current;
}

export async function getMeta(): Promise<MetaResponse> {
  const [ci, status] = await Promise.all([
    catalogInfo(),
    db()
      .query<{ state: string; progress: string | null; error: string | null }>(
        "SELECT state, progress, error FROM public.crawl_status WHERE id = 1",
      )
      .then((r) => r.rows[0])
      .catch(() => undefined),
  ]);
  const catalog: CatalogStatus = {
    gameCount: ci.gameCount,
    storeCounts: ci.storeCounts,
    updatedAt: ci.updatedAt,
    refreshing: status?.state === "running",
    progress: status?.progress ?? null,
    currency: ci.currency,
    lastError: status?.state === "failed" ? status.error : null,
  };
  return { ...catalog, tags: ci.tags.map((t) => ({ tag: t.name, count: t.count })) };
}

// ---------------------------------------------------------------------------
// Query building. Every value goes in as a parameter; only column names and
// operators from fixed lists are spliced into the SQL.

class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

const bits = <T extends { key: string }>(list: readonly T[], keys: string[]) =>
  list.reduce((m, item, bit) => (keys.includes(item.key) ? m | (1 << bit) : m), 0) | 0;

const yearStart = (y: number) => Math.floor(Date.UTC(y, 0, 1) / 1000);

function whereClauses(q: SearchQuery, ci: CatalogInfo, p: Params, ids?: string[]): string[] {
  const w: string[] = [];
  if (ids) w.push(`id = ANY(${p.add(ids)}::text[])`);

  if (q.tags.length) {
    const tagIds = q.tags.map((t) => ci.tagIds.get(t.toLowerCase()));
    // An unknown tag can't match anything.
    w.push(tagIds.some((t) => t === undefined) ? "false" : `tag_ids @> ${p.add(tagIds)}::int[]`);
  }
  const notTags = q.notTags.map((t) => ci.tagIds.get(t.toLowerCase())).filter((t) => t !== undefined);
  if (notTags.length) w.push(`NOT (tag_ids && ${p.add(notTags)}::int[])`);

  const features = bits(FEATURES, q.features);
  if (features) w.push(`(features & ${p.add(features)}) = ${p.add(features)}`);
  const notFeatures = bits(FEATURES, q.notFeatures);
  if (notFeatures) w.push(`(features & ${p.add(notFeatures)}) = 0`);
  const lang = q.lang ? LANGUAGE_BY_CODE.get(q.lang) : undefined;
  if (lang) w.push(`(${q.audio ? "audio" : "langs"} & ${p.add((1 << lang.id) | 0)}) <> 0`);
  const hide = bits(CONTENT_FILTERS, q.hide);
  if (hide) w.push(`(content & ${p.add(hide)}) = 0`);

  if (q.minReviews !== null) w.push(`review_count >= ${p.add(q.minReviews)}`);
  if (q.maxReviews !== null) w.push(`review_count <= ${p.add(q.maxReviews)}`);
  if (q.minPct !== null) w.push(`review_count > 0 AND review_pct >= ${p.add(q.minPct)}`);
  if (q.minPlayers !== null) w.push(`coalesce(peak_players, 0) >= ${p.add(q.minPlayers)}`);
  if (q.minPrice !== null) w.push(`best_price >= ${p.add(Math.round(q.minPrice * 100))}`);
  if (q.maxPrice !== null) w.push(`best_price <= ${p.add(Math.round(q.maxPrice * 100))}`);
  if (q.discounted) w.push("best_discount > 0");
  if (q.minDiscount !== null) w.push(`best_discount >= ${p.add(q.minDiscount)}`);
  if (q.days !== null) {
    w.push(`NOT coming_soon AND release_date >= ${p.add(Math.floor(Date.now() / 1000) - q.days * 86400)}`);
  }
  if (q.minYear !== null) w.push(`release_date >= ${p.add(yearStart(q.minYear))}`);
  if (q.maxYear !== null) w.push(`release_date < ${p.add(yearStart(q.maxYear + 1))}`);

  const tri = (mode: SearchQuery["free"], column: string) => {
    if (mode === "only") w.push(column);
    else if (mode === "exclude") w.push(`NOT ${column}`);
  };
  tri(q.free, "free");
  tri(q.earlyAccess, "early_access");
  tri(q.upcoming, "coming_soon");

  const platforms = (q.platforms.includes("windows") ? 1 : 0) | (q.platforms.includes("mac") ? 2 : 0) | (q.platforms.includes("linux") ? 4 : 0);
  if (platforms) w.push(`(platforms & ${p.add(platforms)}) = ${p.add(platforms)}`);
  if (q.deck) w.push(`deck >= ${p.add(q.deck)}`);
  if (q.stores.length) w.push(`store_ids && ${p.add(q.stores)}::text[]`);
  if (q.dev.trim()) {
    w.push(`people_list @> ARRAY[${p.add(q.dev.trim().toLowerCase())}::text]`);
  }
  return w;
}

/**
 * Text search over titles (fuzzy, via pg_trgm) and developer/publisher names.
 * Returns the match condition and a relevance score expression. A query that is
 * exactly a tag name ("roguelike") also matches games with that tag, ranked by
 * popularity.
 */
function textSearch(qText: string, ci: CatalogInfo, p: Params, withScore: boolean): { where: string; score: string } {
  const key = titleKey(qText);
  // One LIKE per word so the trigram index can be used; words under 3 letters can't
  // use it, so they're dropped unless nothing else is left.
  const words = key.split(" ").filter(Boolean);
  const terms = words.filter((w) => w.length >= 3).length ? words.filter((w) => w.length >= 3) : [key];
  const k = p.add(key);
  const allTerms = `(${terms.map((t) => `search_name LIKE ${p.add(`%${t}%`)}`).join(" AND ")})`;
  const fuzzy = `${k} <% search_name`;
  const person = `people LIKE ${p.add(`%${key}%`)}`;
  const titleMatch = `(${allTerms} OR ${fuzzy})`;
  const popularity = "(1 + log(review_count + 1) * 0.15)";
  const textScore = () => `(
      (CASE WHEN search_name = ${k} THEN 1000 ELSE 0 END)
    + (CASE WHEN ${allTerms} THEN 10 ELSE 0 END)
    + (CASE WHEN search_name LIKE ${p.add(`${key}%`)} THEN 5 ELSE 0 END)
    + word_similarity(${k}, search_name) * 10
    + similarity(${k}, search_name) * 5
    + (CASE WHEN ${person} THEN 8 ELSE 0 END)
  ) * ${popularity}`;

  const tag = ci.tagIds.get(qText.trim().toLowerCase());
  if (tag === undefined) return { where: `(${titleMatch} OR ${person})`, score: withScore ? textScore() : "0" };

  const t = p.add(tag);
  const tagged = `tag_ids @> ARRAY[${t}::int]`;
  return {
    where: `(${titleMatch} OR ${person} OR ${tagged})`,
    score: !withScore ? "0" : `CASE WHEN search_name = ${k} THEN 1e15 ELSE
      (review_count + 1)::float8
      / (1 + (coalesce(array_position(tag_ids, ${t}::int), 21) - 1) * 0.3)
      * (CASE WHEN ${titleMatch} THEN 3 ELSE 1 END) END`,
  };
}

const ORDER: Record<Exclude<SearchQuery["sort"], "relevance">, string> = {
  rating: "rating DESC, review_count DESC",
  reviews: "review_count DESC",
  players: "peak_players DESC NULLS LAST, review_count DESC",
  newest: "release_date DESC NULLS LAST",
  oldest: "release_date ASC NULLS LAST",
  priceAsc: "best_price ASC NULLS LAST, review_count DESC",
  priceDesc: "best_price DESC NULLS LAST",
  deal: "deal_score DESC, review_count DESC",
  discount: "best_discount DESC, review_count DESC",
  name: "search_name ASC",
};

/** One page of results plus total, feature/language counts and tag facets. */
export async function searchGames(query: SearchQuery, pageSize = PAGE_SIZE, ids?: string[]): Promise<SearchResponse> {
  const started = performance.now();
  const ci = await catalogInfo();
  const qText = query.q.trim();
  // Built twice: the count queries must get exactly the parameters they reference,
  // and the page query adds more for scoring and paging.
  const filter = (withScore: boolean) => {
    const p = new Params();
    const where = whereClauses(query, ci, p, ids);
    let score = "0";
    if (qText) {
      const text = textSearch(qText, ci, p, withScore);
      where.push(text.where);
      score = text.score;
    }
    return { p, score, whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "" };
  };
  const sort = query.sort === "relevance" && !qText ? "reviews" : query.sort;
  const byScore = sort === "relevance";
  const { p, score, whereSql } = filter(byScore);
  const counted = filter(false);
  const order = byScore ? `${score} DESC, review_count DESC` : ORDER[sort];

  // Ids of the page from the narrow table first, then display data for just those.
  const limit = p.add(pageSize);
  const offset = p.add((query.page - 1) * pageSize);
  const pageSql = `SELECT id FROM ${G} ${whereSql} ORDER BY ${order}, id LIMIT ${limit} OFFSET ${offset}`;
  const [page, counts] = await Promise.all([
    db().query<{ id: string }>(pageSql, p.values),
    countsFor(counted.whereSql, counted.p.values, query, ci),
  ]);
  const pageIds = page.rows.map((r) => r.id);
  const results = pageIds.length
    ? await db().query<GameRow>(`SELECT ${SUMMARY_COLUMNS} FROM ${fullGame(LIVE)} WHERE g.id = ANY($1::text[])`, [pageIds])
    : { rows: [] as GameRow[] };
  const byId = new Map(results.rows.map((r) => [r.id, rowToSummary(r)]));

  return {
    total: counts.total,
    page: query.page,
    pageSize,
    results: pageIds.flatMap((id) => byId.get(id) ?? []),
    tagFacets: counts.tagFacets,
    featureCounts: counts.featureCounts,
    languageCounts: counts.languageCounts,
    tookMs: Math.round(performance.now() - started),
  };
}

type Counts = Pick<SearchResponse, "total" | "tagFacets" | "featureCounts" | "languageCounts">;

// Counts don't depend on sort or page, and broad searches (Discover shelves, plain
// browsing) repeat a lot, so they're cached until the catalogue changes.
const countsCache = new Map<string, Promise<Counts>>();
let countsCacheFor: string | null = null;
const COUNTS_CACHE_SIZE = 500;

function countsFor(whereSql: string, params: unknown[], query: SearchQuery, ci: CatalogInfo): Promise<Counts> {
  if (countsCacheFor !== ci.updatedAt) {
    countsCache.clear();
    countsCacheFor = ci.updatedAt;
  }
  const key = JSON.stringify([whereSql, params, query.audio, query.tags]);
  const hit = countsCache.get(key);
  if (hit) {
    // Refresh recency so frequent searches stay cached.
    countsCache.delete(key);
    countsCache.set(key, hit);
    return hit;
  }
  const value = computeCounts(whereSql, params, query, ci);
  value.catch(() => countsCache.delete(key));
  countsCache.set(key, value);
  if (countsCache.size > COUNTS_CACHE_SIZE) countsCache.delete(countsCache.keys().next().value!);
  return value;
}

async function computeCounts(whereSql: string, params: unknown[], query: SearchQuery, ci: CatalogInfo): Promise<Counts> {
  const langCol = query.audio ? "audio" : "langs";
  // One scan grouped by each bitmask; the per-bit counts are summed up here, which is
  // far cheaper than 60 separate FILTER aggregates in SQL.
  const groupedSql = `SELECT features, ${langCol} AS lm, count(*)::int AS n FROM ${G} ${whereSql}
                      GROUP BY GROUPING SETS ((features), (${langCol}))`;
  const facetsSql = `SELECT t AS id, count(*)::int AS n FROM ${G}, unnest(tag_ids) t ${whereSql}
                     GROUP BY t ORDER BY n DESC LIMIT ${FACET_COUNT + query.tags.length}`;
  const [grouped, facets] = await Promise.all([
    db().query<{ features: number | null; lm: number | null; n: number }>(groupedSql, params),
    db().query<{ id: number; n: number }>(facetsSql, params),
  ]);

  let total = 0;
  const featureHits = new Array<number>(32).fill(0);
  const langHits = new Array<number>(32).fill(0);
  for (const r of grouped.rows) {
    if (r.features !== null) {
      total += r.n;
      for (let m = r.features; m !== 0; m &= m - 1) featureHits[31 - Math.clz32(m & -m)] += r.n;
    } else if (r.lm !== null) {
      for (let m = r.lm; m !== 0; m &= m - 1) langHits[31 - Math.clz32(m & -m)] += r.n;
    }
  }
  const tagName = new Map(ci.tags.map((t) => [t.id, t.name]));
  const selected = new Set(query.tags.map((t) => t.toLowerCase()));
  return {
    total,
    tagFacets: facets.rows
      .map((f) => ({ tag: tagName.get(f.id) ?? String(f.id), count: f.n }))
      .filter((f) => !selected.has(f.tag.toLowerCase()))
      .slice(0, FACET_COUNT),
    featureCounts: Object.fromEntries(FEATURES.map((f, b) => [f.key, featureHits[b]])),
    languageCounts: Object.fromEntries(LANGUAGES.map((l) => [l.code, langHits[l.id]])),
  };
}

/**
 * Games sharing the most distinctive tags with `id`, favouring well-rated ones.
 * Tags weigh more when they rank high on both games and when they're rare (IDF),
 * so sharing "Metroidvania" counts far more than sharing "Indie". Tags on more
 * than a quarter of all games are ignored.
 */
export async function similarGames(id: string, limit = 12): Promise<GameSummary[]> {
  const ci = await catalogInfo();
  const n = Math.max(1, ci.gameCount);
  // Candidates share at least one distinctive tag (a GIN index lookup); each is then
  // scored over its own ~20 tags.
  const { rows: top } = await db().query<{ id: string }>(
    `WITH target AS (SELECT tag_ids FROM ${G} WHERE id = $1),
     weights AS (
       SELECT u.tag, (1.0 / (1 + (u.ord - 1) * 0.15)) * ln($2::float8 / t.count) AS w
         FROM target, unnest(target.tag_ids) WITH ORDINALITY AS u(tag, ord)
         JOIN ${LIVE}.tags t ON t.id = u.tag
        WHERE t.count > 0 AND t.count <= $2::float8 * 0.25
     )
     SELECT g.id
       FROM ${G} g,
            LATERAL (
              SELECT sum(w.w / (1 + (o.ord - 1) * 0.15)) AS s
                FROM unnest(g.tag_ids) WITH ORDINALITY AS o(tag, ord)
                JOIN weights w ON w.tag = o.tag
            ) score
      WHERE g.tag_ids && (SELECT array_agg(tag) FROM weights)
        AND g.id <> $1 AND g.review_count >= 10 AND NOT g.coming_soon
      ORDER BY score.s * (g.rating / 100.0) ^ 2 DESC
      LIMIT $3`,
    [id, n, limit],
  );
  const ids = top.map((r) => r.id);
  if (!ids.length) return [];
  const { rows } = await db().query<GameRow>(`SELECT ${SUMMARY_COLUMNS} FROM ${fullGame(LIVE)} WHERE g.id = ANY($1::text[])`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, rowToSummary(r)]));
  return ids.flatMap((i) => byId.get(i) ?? []);
}

/** Full games by id (for price lookups); unknown ids are skipped. */
export async function getGames(ids: string[]): Promise<Game[]> {
  if (!ids.length) return [];
  const { rows } = await db().query<GameRow>(`SELECT * FROM ${fullGame(LIVE)} WHERE id = ANY($1::text[])`, [ids]);
  const byId = new Map(rows.map((r) => [r.id, rowToGame(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

export async function getGameDetail(id: string): Promise<GameDetailResponse | null> {
  const { rows } = await db().query<GameRow>(`SELECT * FROM ${fullGame(LIVE)} WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  const game = rowToGame(row);
  return {
    game,
    summary: { ...summarize(game), tags: game.tags.slice(0, 8) },
    features: featureKeysOf(row.features),
    languages: languagesOf(row.langs, row.audio),
  };
}

/** Which of `ids` exist, in the given order. */
export async function existingIds(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { rows } = await db().query<{ id: string }>(`SELECT id FROM ${G} WHERE id = ANY($1::text[])`, [ids]);
  const found = new Set(rows.map((r) => r.id));
  return ids.filter((id) => found.has(id));
}
