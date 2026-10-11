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
  bestStore: StoreId | null;
  free: boolean;
  stores: StoreId[];
}

export interface SearchResponse {
  total: number;
  page: number;
  pageSize: number;
  results: GameSummary[];
  /** Most common tags among all matches (not just this page). */
  tagFacets: { tag: string; count: number }[];
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
}
