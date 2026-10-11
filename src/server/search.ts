import MiniSearch from "minisearch";
import { CONTENT_FILTERS, FEATURES, LANGUAGES, LANGUAGE_BY_CODE, type FeatureKey } from "../shared/features.ts";
import type { SearchQuery } from "../shared/query.ts";
import type { Game, GameSummary, SearchResponse, StoreListing } from "../shared/types.ts";
import { titleKey } from "./merge.ts";

export const PAGE_SIZE = 30;
const FACET_COUNT = 40;

/**
 * SteamDB's rating formula: pulls the positive share towards 50% when there are
 * few reviews, so a 100% game with 3 reviews doesn't outrank a 97% game with 300k.
 */
export function bayesRating(pct: number, count: number): number {
  const avg = pct / 100;
  return (avg - (avg - 0.5) * 2 ** -Math.log10(count + 1)) * 100;
}

function bestListing(stores: StoreListing[]): StoreListing | null {
  let best: StoreListing | null = null;
  for (const s of stores) {
    if (s.price === null) continue;
    if (!best || s.price < best.price!) best = s;
  }
  return best;
}

export function summarize(game: Game): GameSummary {
  const reviewCount = game.stores.reduce((n, s) => n + s.reviewCount, 0);
  const reviewPct = reviewCount
    ? Math.round(game.stores.reduce((n, s) => n + s.reviewPct * s.reviewCount, 0) / reviewCount)
    : 0;
  const best = bestListing(game.stores);
  return {
    id: game.id,
    name: game.name,
    image: game.image,
    tags: game.tags.slice(0, 8),
    developers: game.developers,
    releaseDate: game.releaseDate,
    comingSoon: game.comingSoon,
    earlyAccess: game.earlyAccess,
    platforms: game.platforms,
    deck: game.deck,
    reviewCount,
    reviewPct,
    rating: Math.round(bayesRating(reviewPct, reviewCount) * 10) / 10,
    bestPrice: best?.price ?? null,
    bestBasePrice: best?.basePrice ?? null,
    bestDiscountPct: best?.discountPct ?? 0,
    bestDiscountEnds: best?.discountPct ? (best.discountEnds ?? null) : null,
    bestStore: best?.store ?? null,
    peakPlayers: game.peakPlayers ?? null,
    free: game.stores.some((s) => s.free),
    stores: game.stores.map((s) => s.store),
  };
}

const lower = (s: string) => s.toLowerCase();

/**
 * JSON.parse gives every occurrence of "Indie" its own string; with ~200k games
 * that's millions of duplicates. Share one instance per distinct value.
 */
function internStrings(games: Game[]) {
  const pool = new Map<string, string>();
  const intern = (s: string) => {
    const hit = pool.get(s);
    if (hit !== undefined) return hit;
    pool.set(s, s);
    return s;
  };
  for (const g of games) {
    g.tags = g.tags.map(intern);
    g.developers = g.developers.map(intern);
    g.publishers = g.publishers.map(intern);
  }
}
const yearOf = (ts: number | null) => (ts ? new Date(ts * 1000).getUTCFullYear() : null);

/** The `k` items with the highest `keys[i]`, best first (min-heap of size k). */
export function topK(items: number[], keys: Float64Array, k: number): number[] {
  const heap = new Int32Array(Math.min(k, items.length));
  let size = 0;
  const less = (a: number, b: number) => keys[heap[a]] < keys[heap[b]];
  const swap = (a: number, b: number) => {
    const t = heap[a];
    heap[a] = heap[b];
    heap[b] = t;
  };
  const siftDown = (i: number) => {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < size && less(l, m)) m = l;
      if (r < size && less(r, m)) m = r;
      if (m === i) return;
      swap(i, m);
      i = m;
    }
  };
  for (const item of items) {
    if (size < heap.length) {
      heap[size] = item;
      for (let i = size++; i > 0; ) {
        const parent = (i - 1) >> 1;
        if (!less(i, parent)) break;
        swap(i, parent);
        i = parent;
      }
    } else if (size > 0 && keys[item] > keys[heap[0]]) {
      heap[0] = item;
      siftDown(0);
    }
  }
  return Array.from(heap.subarray(0, size)).sort((a, b) => keys[b] - keys[a]);
}

const tri = (mode: SearchQuery["free"], value: boolean) => mode === "include" || (mode === "only" ? value : !value);

interface Masks {
  features: number;
  notFeatures: number;
  lang: number;
  audio: number;
  hide: number;
  releasedAfter: number | null;
  dev: string;
}

function buildMasks(q: SearchQuery): Masks {
  const featureMask = (keys: string[]) =>
    FEATURES.reduce((m, f, bit) => (keys.includes(f.key) ? m | (1 << bit) : m), 0) >>> 0;
  const lang = q.lang ? LANGUAGE_BY_CODE.get(q.lang) : undefined;
  const langBit = lang ? (1 << lang.id) >>> 0 : 0;
  return {
    features: featureMask(q.features),
    notFeatures: featureMask(q.notFeatures),
    lang: q.audio ? 0 : langBit,
    audio: q.audio ? langBit : 0,
    hide: CONTENT_FILTERS.reduce((m, c, bit) => (q.hide.includes(c.key) ? m | (1 << bit) : m), 0),
    releasedAfter: q.days !== null ? Math.floor(Date.now() / 1000) - q.days * 86400 : null,
    dev: lower(q.dev.trim()),
  };
}

export class SearchIndex {
  readonly games: Game[];
  private readonly summaries: GameSummary[];
  /** Per game, ids into `tagNames` (lowercased tag -> id via `tagIds`). */
  private readonly gameTags: Uint16Array[];
  private readonly tagNames: string[] = [];
  private readonly tagIds = new Map<string, number>();
  private readonly titleKeys: string[];
  private readonly sortNames: string[];
  private readonly byId: Map<string, number>;
  private readonly titles: MiniSearch<{ i: number; name: string }>;
  /** Developer/publisher names are indexed once each; `peopleGames` maps a name back to its games. */
  private readonly people: MiniSearch<{ i: number; name: string }>;
  private readonly peopleGames: number[][] = [];
  /** Bit i set = game has FEATURES[i]. */
  private readonly featureMasks: Uint32Array;
  /** Bit = Steam ELanguage id; interface/subtitles and full audio. */
  private readonly langMasks: Uint32Array;
  private readonly audioMasks: Uint32Array;
  /** Bit i set = game has CONTENT_FILTERS[i] content. */
  private readonly contentMasks: Uint8Array;
  /** Discount weighted by quality: a 50% cut on a great game beats 90% off a bad one. */
  private readonly dealScores: Float32Array;
  /** tag id -> indices of games carrying it, and the tag's rank on each, for similar-game lookups. */
  private readonly tagPostings: Uint32Array[];
  private readonly tagPostingRanks: Uint8Array[];
  /** Every tag in the catalogue with how many games carry it, most common first. */
  readonly allTags: { tag: string; count: number }[];

  constructor(games: Game[]) {
    internStrings(games);
    this.games = games;
    this.summaries = games.map(summarize);
    this.titleKeys = games.map((g) => titleKey(g.name));
    this.sortNames = games.map((g) => lower(g.name));
    this.byId = new Map(games.map((g, i) => [g.id, i]));

    this.gameTags = games.map((g) => Uint16Array.from(g.tags, (t) => this.tagId(t)));

    const categoryBits = new Map<number, number>();
    FEATURES.forEach((f, bit) => {
      for (const c of f.categories) categoryBits.set(c, (categoryBits.get(c) ?? 0) | (1 << bit));
    });
    const descriptorBits = new Map<number, number>();
    CONTENT_FILTERS.forEach((c, bit) => {
      for (const d of c.descriptors) descriptorBits.set(d, (descriptorBits.get(d) ?? 0) | (1 << bit));
    });
    const orBits = (ids: number[] | undefined, bits: (id: number) => number) => {
      let mask = 0;
      for (const id of ids ?? []) mask |= bits(id);
      return mask >>> 0;
    };
    const langBit = (id: number) => (id >= 0 && id < 32 ? 1 << id : 0);
    this.featureMasks = Uint32Array.from(games, (g) => orBits(g.categories, (c) => categoryBits.get(c) ?? 0));
    this.langMasks = Uint32Array.from(games, (g) => orBits(g.languages, langBit));
    this.audioMasks = Uint32Array.from(games, (g) => orBits(g.audioLanguages, langBit));
    this.contentMasks = Uint8Array.from(games, (g) => orBits(g.contentDescriptors, (d) => descriptorBits.get(d) ?? 0));
    const counts = new Uint32Array(this.tagNames.length);
    for (const ids of this.gameTags) for (const id of ids) counts[id]++;
    this.allTags = this.tagNames.map((tag, id) => ({ tag, count: counts[id] })).sort((a, b) => b.count - a.count);
    this.tagPostings = Array.from(counts, (n) => new Uint32Array(n));
    this.tagPostingRanks = Array.from(counts, (n) => new Uint8Array(n));
    const fill = new Uint32Array(counts.length);
    this.gameTags.forEach((ids, i) => {
      ids.forEach((id, rank) => {
        this.tagPostingRanks[id][fill[id]] = Math.min(rank, 255);
        this.tagPostings[id][fill[id]++] = i;
      });
    });
    this.dealScores = Float32Array.from(this.summaries, (s) =>
      s.bestDiscountPct > 0 && s.reviewCount >= 10 ? s.bestDiscountPct * Math.max(0, s.rating - 50) : 0,
    );

    const searchOptions = { prefix: true, fuzzy: 0.2 };
    this.titles = new MiniSearch({ idField: "i", fields: ["name"], searchOptions });
    this.titles.addAll(games.map((g, i) => ({ i, name: g.name })));

    const personIds = new Map<string, number>();
    games.forEach((g, i) => {
      for (const name of new Set([...g.developers, ...g.publishers])) {
        let id = personIds.get(name);
        if (id === undefined) personIds.set(name, (id = this.peopleGames.push([]) - 1));
        this.peopleGames[id].push(i);
      }
    });
    this.people = new MiniSearch({ idField: "i", fields: ["name"], searchOptions });
    this.people.addAll([...personIds].map(([name, i]) => ({ i, name })));
  }

  /** Id for a tag, case-insensitively; the first spelling seen becomes the display name. */
  private tagId(tag: string): number {
    const key = lower(tag);
    let id = this.tagIds.get(key);
    if (id === undefined) {
      id = this.tagNames.push(tag) - 1;
      this.tagIds.set(key, id);
    }
    return id;
  }

  get(id: string): { game: Game; summary: GameSummary; features: FeatureKey[]; languages: { code: string; audio: boolean }[] } | null {
    const i = this.byId.get(id);
    if (i === undefined) return null;
    const fm = this.featureMasks[i];
    return {
      game: this.games[i],
      summary: this.summaries[i],
      features: FEATURES.filter((_, bit) => (fm & (1 << bit)) !== 0).map((f) => f.key),
      languages: LANGUAGES.filter((l) => (this.langMasks[i] & (1 << l.id)) !== 0).map((l) => ({
        code: l.code,
        audio: (this.audioMasks[i] & (1 << l.id)) !== 0,
      })),
    };
  }

  /** Indices of games matching the text query (title, developer or publisher), best first. */
  private textMatches(q: string): number[] {
    const key = titleKey(q);
    // Nudge popular games up so "portal" finds Portal before a 0-review clone.
    const popularity = (i: number) => 1 + Math.log10(this.summaries[i].reviewCount + 1) * 0.15;
    const run = (combineWith: "AND" | "OR") => {
      const scores = new Map<number, number>();
      for (const h of this.titles.search(q, { combineWith })) {
        const i = h.id as number;
        // Exact title matches always win.
        scores.set(i, h.score * 4 * popularity(i) * (this.titleKeys[i] === key ? 10 : 1));
      }
      for (const h of this.people.search(q, { combineWith })) {
        for (const i of this.peopleGames[h.id as number]) {
          scores.set(i, Math.max(scores.get(i) ?? 0, h.score * popularity(i)));
        }
      }
      return scores;
    };
    let scores = run("AND");
    if (!scores.size) scores = run("OR");
    const ranked = [...scores].sort((a, b) => b[1] - a[1]).map(([i]) => i);


    // A query that is exactly a tag name ("roguelike", "co-op") is really a tag search:
    // rank every game with that tag (or the word in its title) by popularity, with a
    // bonus for title matches and for games where the tag ranks high.
    const tag = this.tagIds.get(lower(q.trim()));
    if (tag === undefined) return ranked;
    const combined = new Map<number, number>();
    const postings = this.tagPostings[tag];
    const ranks = this.tagPostingRanks[tag];
    for (let k = 0; k < postings.length; k++) {
      combined.set(postings[k], (this.summaries[postings[k]].reviewCount + 1) / (1 + ranks[k] * 0.3));
    }
    for (const i of ranked) {
      const exact = this.titleKeys[i] === key;
      combined.set(i, exact ? Infinity : ((combined.get(i) ?? this.summaries[i].reviewCount + 1)) * 3);
    }
    return [...combined].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  }

  private matchesFilters(i: number, q: SearchQuery, tags: number[], notTags: number[], m: Masks): boolean {
    const g = this.games[i];
    const s = this.summaries[i];
    const gameTags = this.gameTags[i];
    for (const t of tags) if (!gameTags.includes(t)) return false;
    for (const t of notTags) if (gameTags.includes(t)) return false;

    if (m.features && (this.featureMasks[i] & m.features) >>> 0 !== m.features) return false;
    if (m.notFeatures && (this.featureMasks[i] & m.notFeatures) !== 0) return false;
    if (m.lang && (this.langMasks[i] & m.lang) === 0) return false;
    if (m.audio && (this.audioMasks[i] & m.audio) === 0) return false;
    if (m.hide && (this.contentMasks[i] & m.hide) !== 0) return false;
    if (q.minPlayers !== null && (g.peakPlayers ?? 0) < q.minPlayers) return false;
    if (q.minDiscount !== null && s.bestDiscountPct < q.minDiscount) return false;
    if (m.releasedAfter !== null && (g.comingSoon || !g.releaseDate || g.releaseDate < m.releasedAfter)) return false;
    if (m.dev && !g.developers.some((d) => lower(d) === m.dev) && !g.publishers.some((d) => lower(d) === m.dev)) {
      return false;
    }

    if (q.minReviews !== null && s.reviewCount < q.minReviews) return false;
    if (q.maxReviews !== null && s.reviewCount > q.maxReviews) return false;
    if (q.minPct !== null && (s.reviewCount === 0 || s.reviewPct < q.minPct)) return false;
    if (q.minPrice !== null && (s.bestPrice === null || s.bestPrice < q.minPrice * 100)) return false;
    if (q.maxPrice !== null && (s.bestPrice === null || s.bestPrice > q.maxPrice * 100)) return false;
    if (q.discounted && s.bestDiscountPct <= 0) return false;

    if (q.minYear !== null || q.maxYear !== null) {
      const y = yearOf(g.releaseDate);
      if (y === null) return false;
      if (q.minYear !== null && y < q.minYear) return false;
      if (q.maxYear !== null && y > q.maxYear) return false;
    }

    if (!tri(q.free, s.free) || !tri(q.earlyAccess, g.earlyAccess) || !tri(q.upcoming, g.comingSoon)) return false;

    for (const p of q.platforms) if (!g.platforms[p]) return false;
    if (q.deck && g.deck < q.deck) return false;
    if (q.stores.length && !s.stores.some((st) => q.stores.includes(st))) return false;
    return true;
  }

  private readonly sortKeys = new Map<SearchQuery["sort"], Float64Array>();

  /**
   * One number per game for a sort order, higher first: the primary key scaled up
   * plus a tie-breaker (usually review count, always < 1e8). Built on first use;
   * comparing two floats is much faster than reading fields off summary objects.
   */
  private sortKey(sort: Exclude<SearchQuery["sort"], "relevance">): Float64Array {
    const cached = this.sortKeys.get(sort);
    if (cached) return cached;
    const s = this.summaries;
    const g = this.games;
    const LAST = -1e300; // unknown values (no price, no date) sort last either way
    const reviews = (i: number) => Math.min(s[i].reviewCount, 99_999_999);
    let key: (i: number) => number;
    switch (sort) {
      case "rating":
        key = (i) => s[i].rating * 1e8 + reviews(i);
        break;
      case "reviews":
        key = reviews;
        break;
      case "players":
        key = (i) => (s[i].peakPlayers ?? 0) * 1e8 + reviews(i);
        break;
      case "newest":
        key = (i) => g[i].releaseDate ?? LAST;
        break;
      case "oldest":
        key = (i) => (g[i].releaseDate ? -g[i].releaseDate! : LAST);
        break;
      case "priceAsc":
        key = (i) => (s[i].bestPrice === null ? LAST : -s[i].bestPrice! * 1e8 + reviews(i));
        break;
      case "priceDesc":
        key = (i) => s[i].bestPrice ?? LAST;
        break;
      case "discount":
        key = (i) => s[i].bestDiscountPct * 1e8 + reviews(i);
        break;
      case "deal":
        key = (i) => Math.round(this.dealScores[i]) * 1e8 + reviews(i);
        break;
      case "name": {
        const order = this.games.map((_, i) => i).sort((a, b) => (this.sortNames[a] < this.sortNames[b] ? -1 : 1));
        const rank = new Float64Array(this.games.length);
        order.forEach((i, r) => (rank[i] = -r));
        key = (i) => rank[i];
        break;
      }
    }
    const keys = Float64Array.from(this.games, (_, i) => key(i));
    this.sortKeys.set(sort, keys);
    return keys;
  }




  /**
   * Games that share the most distinctive tags with `id`, favouring well-rated ones.
   * Tags are weighted by their rank on each game and by rarity (IDF), so sharing
   * "Roguelike Deckbuilder" counts far more than sharing "Singleplayer".
   */
  similar(id: string, limit = 12): GameSummary[] {
    const target = this.byId.get(id);
    if (target === undefined) return [];
    const n = this.games.length;
    const scores = new Float32Array(n);
    const touched: number[] = [];
    const rankWeight = (rank: number) => 1 / (1 + rank * 0.15);
    this.gameTags[target].forEach((tag, rank) => {
      const postings = this.tagPostings[tag];
      const ranks = this.tagPostingRanks[tag];
      if (postings.length > n * 0.25) return; // too common to say anything (Indie, Singleplayer, ...)
      const w = rankWeight(rank) * Math.log(n / postings.length);
      for (let k = 0; k < postings.length; k++) {
        const i = postings[k];
        if (scores[i] === 0) touched.push(i);
        scores[i] += w * rankWeight(ranks[k]);
      }
    });
    // Keep a small sorted top-k instead of sorting tens of thousands of candidates.
    const s = this.summaries;
    const top: { i: number; score: number }[] = [];
    for (const i of touched) {
      if (i === target || s[i].reviewCount < 10 || this.games[i].comingSoon) continue;
      const score = scores[i] * (s[i].rating / 100) ** 2;
      if (top.length === limit && score <= top[limit - 1].score) continue;
      let k = top.length;
      while (k > 0 && top[k - 1].score < score) k--;
      top.splice(k, 0, { i, score });
      if (top.length > limit) top.pop();
    }
    return top.map((t) => s[t.i]);
  }

  /** Summaries for the given ids, skipping unknown ones; keeps input order. */
  summariesFor(ids: string[]): GameSummary[] {
    return ids.flatMap((id) => {
      const i = this.byId.get(id);
      return i === undefined ? [] : [this.summaries[i]];
    });
  }

  search(query: SearchQuery, pageSize = PAGE_SIZE, onlyIds?: string[]): SearchResponse {
    const started = performance.now();
    const q = query.q.trim();
    let candidates = q ? this.textMatches(q) : this.games.map((_, i) => i);
    if (onlyIds) {
      const allowed = new Set(onlyIds.map((id) => this.byId.get(id)).filter((i) => i !== undefined));
      candidates = candidates.filter((i) => allowed.has(i));
    }
    // An unknown tag can't match anything; an unknown excluded tag excludes nothing.
    const tags = query.tags.map((t) => this.tagIds.get(lower(t)) ?? -1);
    const notTags = query.notTags.map((t) => this.tagIds.get(lower(t))).filter((t) => t !== undefined);
    const masks = buildMasks(query);
    const matches = candidates.filter((i) => this.matchesFilters(i, query, tags, notTags, masks));

    // Without a text query "relevance" has nothing to rank by, so use popularity.
    const sort = query.sort === "relevance" && !q ? "reviews" : query.sort;
    const start = (query.page - 1) * pageSize;
    let ordered = matches;
    if (sort !== "relevance") {
      // Only the first pages are usually wanted: a top-k heap beats sorting everything.
      const keys = this.sortKey(sort);
      const need = start + pageSize;
      ordered = need <= 3000 ? topK(matches, keys, need) : [...matches].sort((a, b) => keys[b] - keys[a]);
    }

    const facetCounts = new Uint32Array(this.tagNames.length);
    for (const i of matches) for (const t of this.gameTags[i]) facetCounts[t]++;
    const tagFacets = this.tagNames
      .map((tag, id) => ({ tag, count: facetCounts[id] }))
      .filter((f, id) => f.count > 0 && !tags.includes(id))
      .sort((a, b) => b.count - a.count)
      .slice(0, FACET_COUNT);

    // How many of the matches have each feature / language: what you'd get by adding it.
    const featureHits = new Uint32Array(FEATURES.length);
    const langHits = new Uint32Array(32); // indexed by ELanguage id
    const langMasks = query.audio ? this.audioMasks : this.langMasks;
    for (const i of matches) {
      // Walk only the set bits: games have a handful of features, not 32.
      for (let m = this.featureMasks[i]; m !== 0; m &= m - 1) featureHits[31 - Math.clz32(m & -m)]++;
      for (let m = langMasks[i]; m !== 0; m &= m - 1) langHits[31 - Math.clz32(m & -m)]++;
    }
    const featureCounts = Object.fromEntries(FEATURES.map((f, b) => [f.key, featureHits[b]]));
    const languageCounts = Object.fromEntries(LANGUAGES.map((l) => [l.code, langHits[l.id]]));

    return {
      featureCounts,
      languageCounts,
      total: matches.length,
      page: query.page,
      pageSize,
      results: ordered.slice(start, start + pageSize).map((i) => this.summaries[i]),
      tagFacets,
      tookMs: Math.round(performance.now() - started),
    };
  }
}
