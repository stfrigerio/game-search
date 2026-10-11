import MiniSearch from "minisearch";
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
    bestStore: best?.store ?? null,
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
    const counts = new Uint32Array(this.tagNames.length);
    for (const ids of this.gameTags) for (const id of ids) counts[id]++;
    this.allTags = this.tagNames.map((tag, id) => ({ tag, count: counts[id] })).sort((a, b) => b.count - a.count);

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

  get(id: string): { game: Game; summary: GameSummary } | null {
    const i = this.byId.get(id);
    return i === undefined ? null : { game: this.games[i], summary: this.summaries[i] };
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
    return [...scores].sort((a, b) => b[1] - a[1]).map(([i]) => i);
  }

  private matchesFilters(i: number, q: SearchQuery, tags: number[], notTags: number[]): boolean {
    const g = this.games[i];
    const s = this.summaries[i];
    const gameTags = this.gameTags[i];
    for (const t of tags) if (!gameTags.includes(t)) return false;
    for (const t of notTags) if (gameTags.includes(t)) return false;

    if (q.minReviews !== null && s.reviewCount < q.minReviews) return false;
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

    const tri = (mode: SearchQuery["free"], value: boolean) =>
      mode === "include" || (mode === "only" ? value : !value);
    if (!tri(q.free, s.free) || !tri(q.earlyAccess, g.earlyAccess) || !tri(q.upcoming, g.comingSoon)) return false;

    for (const p of q.platforms) if (!g.platforms[p]) return false;
    if (q.deck && g.deck < q.deck) return false;
    if (q.stores.length && !s.stores.some((st) => q.stores.includes(st))) return false;
    return true;
  }

  private comparator(sort: SearchQuery["sort"]): ((a: number, b: number) => number) | null {
    const s = this.summaries;
    const g = this.games;
    // Unknown values (no price, no date) always sort last.
    const nullsLast = (x: number | null, y: number | null, dir: 1 | -1) =>
      x === null ? (y === null ? 0 : 1) : y === null ? -1 : (x - y) * dir;
    switch (sort) {
      case "relevance":
        return null;
      case "rating":
        return (a, b) => s[b].rating - s[a].rating || s[b].reviewCount - s[a].reviewCount;
      case "reviews":
        return (a, b) => s[b].reviewCount - s[a].reviewCount;
      case "newest":
        return (a, b) => nullsLast(g[a].releaseDate, g[b].releaseDate, -1);
      case "oldest":
        return (a, b) => nullsLast(g[a].releaseDate, g[b].releaseDate, 1);
      case "priceAsc":
        return (a, b) => nullsLast(s[a].bestPrice, s[b].bestPrice, 1) || s[b].reviewCount - s[a].reviewCount;
      case "priceDesc":
        return (a, b) => nullsLast(s[a].bestPrice, s[b].bestPrice, -1);
      case "discount":
        return (a, b) => s[b].bestDiscountPct - s[a].bestDiscountPct || s[b].reviewCount - s[a].reviewCount;
      case "name": {
        const n = this.sortNames;
        return (a, b) => (n[a] < n[b] ? -1 : n[a] > n[b] ? 1 : 0);
      }
    }
  }

  search(query: SearchQuery, pageSize = PAGE_SIZE): SearchResponse {
    const started = performance.now();
    const q = query.q.trim();
    const candidates = q ? this.textMatches(q) : this.games.map((_, i) => i);
    // An unknown tag can't match anything; an unknown excluded tag excludes nothing.
    const tags = query.tags.map((t) => this.tagIds.get(lower(t)) ?? -1);
    const notTags = query.notTags.map((t) => this.tagIds.get(lower(t))).filter((t) => t !== undefined);
    const matches = candidates.filter((i) => this.matchesFilters(i, query, tags, notTags));

    // Without a text query "relevance" has nothing to rank by, so use popularity.
    const cmp = this.comparator(query.sort === "relevance" && !q ? "reviews" : query.sort);
    if (cmp) matches.sort(cmp);

    const facetCounts = new Uint32Array(this.tagNames.length);
    for (const i of matches) for (const t of this.gameTags[i]) facetCounts[t]++;
    const tagFacets = this.tagNames
      .map((tag, id) => ({ tag, count: facetCounts[id] }))
      .filter((f, id) => f.count > 0 && !tags.includes(id))
      .sort((a, b) => b.count - a.count)
      .slice(0, FACET_COUNT);

    const start = (query.page - 1) * pageSize;
    return {
      total: matches.length,
      page: query.page,
      pageSize,
      results: matches.slice(start, start + pageSize).map((i) => this.summaries[i]),
      tagFacets,
      tookMs: Math.round(performance.now() - started),
    };
  }
}
