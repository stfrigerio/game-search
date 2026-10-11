import type { StoreId } from "./types.ts";

export const SORTS = {
  relevance: "Relevance",
  rating: "Best rated",
  reviews: "Most reviewed",
  newest: "Newest",
  oldest: "Oldest",
  priceAsc: "Price: low to high",
  priceDesc: "Price: high to low",
  deal: "Best deals",
  discount: "Biggest discount",
  name: "Name",
} as const;
export type SortKey = keyof typeof SORTS;

export type Tristate = "include" | "exclude" | "only";

export interface SearchQuery {
  q: string;
  tags: string[];
  notTags: string[];
  minReviews: number | null;
  maxReviews: number | null;
  minPct: number | null;
  minPrice: number | null;
  /** Max price in whole currency units. */
  maxPrice: number | null;
  minYear: number | null;
  maxYear: number | null;
  discounted: boolean;
  free: Tristate;
  earlyAccess: Tristate;
  upcoming: Tristate;
  platforms: ("windows" | "mac" | "linux")[];
  /** Minimum Steam Deck compat: 2 = playable or verified, 3 = verified only. */
  deck: 0 | 2 | 3;
  stores: StoreId[];
  sort: SortKey;
  page: number;
}

export const DEFAULT_QUERY: SearchQuery = {
  q: "",
  tags: [],
  notTags: [],
  minReviews: null,
  maxReviews: null,
  minPct: null,
  minPrice: null,
  maxPrice: null,
  minYear: null,
  maxYear: null,
  discounted: false,
  free: "include",
  earlyAccess: "include",
  upcoming: "exclude",
  platforms: [],
  deck: 0,
  stores: [],
  sort: "relevance",
  page: 1,
};

const list = (v: string | null) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []);
const num = (v: string | null) => {
  if (v === null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const tri = (v: string | null, fallback: Tristate): Tristate =>
  v === "include" || v === "exclude" || v === "only" ? v : fallback;

export function parseQuery(params: URLSearchParams): SearchQuery {
  const d = DEFAULT_QUERY;
  const sort = params.get("sort");
  const deck = num(params.get("deck"));
  return {
    q: params.get("q") ?? "",
    tags: list(params.get("tags")),
    notTags: list(params.get("notTags")),
    minReviews: num(params.get("minReviews")),
    maxReviews: num(params.get("maxReviews")),
    minPct: num(params.get("minPct")),
    minPrice: num(params.get("minPrice")),
    maxPrice: num(params.get("maxPrice")),
    minYear: num(params.get("minYear")),
    maxYear: num(params.get("maxYear")),
    discounted: params.get("discounted") === "1",
    free: tri(params.get("free"), d.free),
    earlyAccess: tri(params.get("earlyAccess"), d.earlyAccess),
    upcoming: tri(params.get("upcoming"), d.upcoming),
    platforms: list(params.get("platforms")).filter(
      (p): p is SearchQuery["platforms"][number] => p === "windows" || p === "mac" || p === "linux",
    ),
    deck: deck === 2 || deck === 3 ? deck : 0,
    stores: list(params.get("stores")).filter((s): s is StoreId => s === "steam" || s === "gog"),
    sort: sort && sort in SORTS ? (sort as SortKey) : d.sort,
    page: Math.max(1, Math.floor(num(params.get("page")) ?? 1)),
  };
}

/** Serialise only the fields that differ from the defaults, so URLs stay short. */
export function serializeQuery(query: SearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  const d = DEFAULT_QUERY;
  if (query.q) params.set("q", query.q);
  if (query.tags.length) params.set("tags", query.tags.join(","));
  if (query.notTags.length) params.set("notTags", query.notTags.join(","));
  for (const key of ["minReviews", "maxReviews", "minPct", "minPrice", "maxPrice", "minYear", "maxYear"] as const) {
    if (query[key] !== null) params.set(key, String(query[key]));
  }
  if (query.discounted) params.set("discounted", "1");
  for (const key of ["free", "earlyAccess", "upcoming"] as const) {
    if (query[key] !== d[key]) params.set(key, query[key]);
  }
  if (query.platforms.length) params.set("platforms", query.platforms.join(","));
  if (query.deck) params.set("deck", String(query.deck));
  if (query.stores.length) params.set("stores", query.stores.join(","));
  if (query.sort !== d.sort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}
