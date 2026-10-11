import type { PowerKey, PowerLevel, Specs } from "./power.ts";

export type StoreId = "steam" | "gog";

/** One store's page for a game. Prices are in the smallest currency unit (cents). */
export interface StoreListing {
  store: StoreId;
  /** The store's own id (Steam appid, GOG product id). */
  storeGameId: string;
  url: string;
  price: number | null;
  basePrice: number | null;
  discountPct: number;
  /** Unix seconds when the current sale ends, if the store says. */
  discountEnds?: number | null;
  free: boolean;
  reviewCount: number;
  /** 0-100, share of positive reviews (GOG star ratings are converted). */
  reviewPct: number;
}

export interface Platforms {
  windows: boolean;
  mac: boolean;
  linux: boolean;
}

/** Steam Deck compatibility as reported by Steam: 0 unknown, 1 unsupported, 2 playable, 3 verified. */
export type DeckCompat = 0 | 1 | 2 | 3;

/** A game merged across every store it is sold on. */
export interface Game {
  /** Stable id: "steam:<appid>" when the game is on Steam, otherwise "<store>:<id>". */
  id: string;
  name: string;
  developers: string[];
  publishers: string[];
  /** Tag names, most relevant first. */
  tags: string[];
  description: string;
  image: string | null;
  /** Unix seconds; null when unknown. */
  releaseDate: number | null;
  comingSoon: boolean;
  earlyAccess: boolean;
  platforms: Platforms;
  deck: DeckCompat;
  /** Steam store category ids (player modes, features, controller support). */
  categories: number[];
  /** Steam ELanguage ids with interface or subtitles, and with full audio. */
  languages: number[];
  audioLanguages: number[];
  /** Steam content descriptor ids (1 nudity, 2 violence/gore, 3 adult sexual, 4 frequent nudity, 5 mature). */
  contentDescriptors: number[];
  /** Peak concurrent players yesterday (SteamSpy). */
  peakPlayers: number | null;
  /** Estimated owners range from SteamSpy, e.g. "2,000,000 .. 5,000,000". */
  owners: string | null;
  steamAppId: number | null;
  stores: StoreListing[];
}

/** What a search result row needs; derived from Game on the server. */
export interface GameSummary {
  id: string;
  name: string;
  image: string | null;
  tags: string[];
  developers: string[];
  releaseDate: number | null;
  comingSoon: boolean;
  earlyAccess: boolean;
  platforms: Platforms;
  deck: DeckCompat;
  reviewCount: number;
  reviewPct: number;
  /** SteamDB-style rating 0-100 that accounts for how many reviews there are. */
  rating: number;
  bestPrice: number | null;
  bestBasePrice: number | null;
  bestDiscountPct: number;
  bestDiscountEnds: number | null;
  bestStore: StoreId | null;
  peakPlayers: number | null;
  free: boolean;
  stores: StoreId[];
  /** How strong a computer it needs, and whether that comes from the store's requirements or is our guess. */
  power: PowerLevel;
  powerKnown: boolean;
}

export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  results: GameSummary[];
  /** Most common tags among all matches (not just this page). */
  tagFacets: { tag: string; count: number }[];
  /** For each feature key / language code, how many matches have it. */
  featureCounts: Record<string, number>;
  languageCounts: Record<string, number>;
  /** How many matches sit at each power level, before the power filter itself is applied. */
  powerCounts: Record<PowerKey, number>;
  tookMs: number;
}

export interface CatalogStatus {
  gameCount: number;
  storeCounts: Partial<Record<StoreId, number>>;
  updatedAt: string | null;
  refreshing: boolean;
  progress: string | null;
  currency: string;
  lastError: string | null;
  /** Games whose power level comes from the store's requirements rather than a guess. */
  specsRead: number;
}

export interface MetaResponse extends CatalogStatus {
  tags: { tag: string; count: number }[];
}

export interface PriceOffer {
  shop: string;
  price: number;
  basePrice: number;
  discountPct: number;
  url: string;
  /** "official" = the publisher-authorised store; "keyshop" = grey-market key reseller. */
  kind: "official" | "keyshop";
}

/** Cheapest live official-store offer for a game (CheapShark, USD). */
export interface BestOffer {
  shop: string;
  price: number;
  basePrice: number;
  discountPct: number;
  url: string;
  historicLow: number | null;
}

export interface PriceLink {
  shop: string;
  url: string;
  kind: "official" | "keyshop" | "tracker";
}

export interface PricesResponse {
  currency: string;
  /** Live prices with an actual number attached. */
  offers: PriceOffer[];
  /** Search pages on sites we can't fetch prices from. */
  links: PriceLink[];
  /** Historic low reported by CheapShark, if known. */
  historicLow: number | null;
  error: string | null;
}

export interface GameDetailResponse {
  game: Game;
  summary: GameSummary;
  features: string[];
  languages: { code: string; audio: boolean }[];
  /** The store's minimum requirements, when we have read them. */
  specs: Specs | null;
}
