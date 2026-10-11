import { CONTENT_FILTERS, FEATURE_BY_KEY, LANGUAGE_BY_CODE, type ContentKey, type FeatureKey } from "./features.ts";
import { POWER_BY_KEY, type PowerKey } from "./power.ts";
import type { StoreId } from "./types.ts";

export const SORTS = {
  relevance: "Relevance",
  rating: "Best rated",
  players: "Most played now",
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
  /** Minimum peak concurrent players yesterday. */
  minPlayers: number | null;
  minPrice: number | null;
  /** Max price in whole currency units. */
  maxPrice: number | null;
  minYear: number | null;
  maxYear: number | null;
  discounted: boolean;
  minDiscount: number | null;
  /** Released within the last N days. */
  days: number | null;
  free: Tristate;
  earlyAccess: Tristate;
  upcoming: Tristate;
  platforms: ("windows" | "mac" | "linux")[];
  /** Minimum Steam Deck compat: 2 = playable or verified, 3 = verified only. */
  deck: 0 | 2 | 3;
  stores: StoreId[];
  /** How strong a computer the game needs; empty means any. */
  power: PowerKey[];
  /** Player modes / features the game must have, and ones it must not. */
  features: FeatureKey[];
  notFeatures: FeatureKey[];
  /** Language code (see LANGUAGES); with `audio`, it must have full audio in it. */
  lang: string | null;
  audio: boolean;
  /** Content to hide. */
  hide: ContentKey[];
  /** Exact developer or publisher name. */
  dev: string;
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
  minPlayers: null,
  minPrice: null,
  maxPrice: null,
  minYear: null,
  maxYear: null,
  discounted: false,
  minDiscount: null,
  days: null,
  free: "include",
  earlyAccess: "include",
  upcoming: "exclude",
  platforms: [],
  deck: 0,
  stores: [],
  power: [],
  features: [],
  notFeatures: [],
  lang: null,
  audio: false,
  hide: [],
  dev: "",
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
    minPlayers: num(params.get("minPlayers")),
    minPrice: num(params.get("minPrice")),
    maxPrice: num(params.get("maxPrice")),
    minYear: num(params.get("minYear")),
    maxYear: num(params.get("maxYear")),
    discounted: params.get("discounted") === "1",
    minDiscount: num(params.get("minDiscount")),
    days: num(params.get("days")),
    free: tri(params.get("free"), d.free),
    earlyAccess: tri(params.get("earlyAccess"), d.earlyAccess),
    upcoming: tri(params.get("upcoming"), d.upcoming),
    platforms: list(params.get("platforms")).filter(
      (p): p is SearchQuery["platforms"][number] => p === "windows" || p === "mac" || p === "linux",
    ),
    deck: deck === 2 || deck === 3 ? deck : 0,
    stores: list(params.get("stores")).filter((s): s is StoreId => s === "steam" || s === "gog"),
    power: list(params.get("power")).filter((p): p is PowerKey => POWER_BY_KEY.has(p)),
    features: list(params.get("features")).filter((f): f is FeatureKey => FEATURE_BY_KEY.has(f)),
    notFeatures: list(params.get("notFeatures")).filter((f): f is FeatureKey => FEATURE_BY_KEY.has(f)),
    lang: LANGUAGE_BY_CODE.has(params.get("lang") ?? "") ? params.get("lang") : null,
    audio: params.get("audio") === "1",
    hide: list(params.get("hide")).filter((h): h is ContentKey => CONTENT_FILTERS.some((c) => c.key === h)),
    dev: params.get("dev") ?? "",
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
  for (const key of ["minReviews", "maxReviews", "minPct", "minPlayers", "minPrice", "maxPrice", "minDiscount", "days", "minYear", "maxYear"] as const) {
    if (query[key] !== null) params.set(key, String(query[key]));
  }
  if (query.discounted) params.set("discounted", "1");
  for (const key of ["free", "earlyAccess", "upcoming"] as const) {
    if (query[key] !== d[key]) params.set(key, query[key]);
  }
  if (query.platforms.length) params.set("platforms", query.platforms.join(","));
  if (query.deck) params.set("deck", String(query.deck));
  if (query.stores.length) params.set("stores", query.stores.join(","));
  if (query.power.length) params.set("power", query.power.join(","));
  if (query.features.length) params.set("features", query.features.join(","));
  if (query.notFeatures.length) params.set("notFeatures", query.notFeatures.join(","));
  if (query.lang) params.set("lang", query.lang);
  if (query.audio) params.set("audio", "1");
  if (query.hide.length) params.set("hide", query.hide.join(","));
  if (query.dev) params.set("dev", query.dev);
  if (query.sort !== d.sort) params.set("sort", query.sort);
  if (query.page > 1) params.set("page", String(query.page));
  return params;
}
