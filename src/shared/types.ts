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

/** A screenshot or trailer, loaded by the browser straight from the store's CDN. */
export type MediaItem =
  | { kind: "image"; thumb: string; full: string }
  | {
      kind: "video";
      title: string;
      thumb: string | null;
      poster: string | null;
      /** HLS playlist (Steam trailers). */
      hls: string | null;
      /** Short silent mp4 preview, if any. */
      preview: string | null;
      /** YouTube video id (GOG trailers). */
      youtube: string | null;
    };

export interface MediaResponse {
  items: MediaItem[];
  error: string | null;
}

/** One game in a Steam library, priced from our catalogue. Prices in cents. */
export interface LibraryGame {
  appId: number;
  /** Our catalogue id, when the game is in it (delisted games and tools aren't). */
  id: string | null;
  name: string;
  image: string | null;
  playtimeMinutes: number;
  /** Minutes played in the last two weeks. */
  recentMinutes: number;
  free: boolean;
  /** Today's best price across stores; null when unknown or delisted. */
  priceNow: number | null;
  /** List price before any discount. */
  priceFull: number | null;
  discountPct: number;
  /** From our catalogue, when the game is in it. */
  tags: string[];
  releaseYear: number | null;
  /** SteamDB-style rating 0-100 and the share of positive reviews. */
  rating: number | null;
  reviewPct: number | null;
  reviewCount: number;
  multiplayer: boolean;
  /** Online co-op, or online versus play: something two friends can play together from home. */
  onlineCoop: boolean;
  onlinePvp: boolean;
}

/** Account facts from Steam; any of them can be missing (private or not returned). */
export interface SteamProfile {
  name: string | null;
  avatar: string | null;
  profileUrl: string | null;
  country: string | null;
  /** Unix seconds. */
  memberSince: number | null;
  level: number | null;
  badges: number | null;
  friends: number | null;
}

/** Everything the profile page charts, computed on the server from the library. */
export interface LibraryInsights {
  topGames: { appId: number; id: string | null; name: string; minutes: number }[];
  /** Hours in games carrying each tag (a game's hours count for each of its top 3 tags). */
  byTag: { tag: string; minutes: number; games: number }[];
  byYear: { year: number; games: number; minutes: number; unplayed: number }[];
  /** Share of all playtime in the most-played game, the next nine, and the rest. */
  concentration: { top1: number; next9: number; rest: number };
  recent: { appId: number; id: string | null; name: string; minutes: number }[];
  /** Best-rated games owned but never launched. */
  unplayedGems: { appId: number; id: string | null; name: string; rating: number; reviewPct: number; priceNow: number | null }[];
  /** Hours-weighted share of positive reviews of what was played. */
  avgReviewPct: number | null;
  multiplayerMinutes: number;
  recentMinutes: number;
}

export interface LibraryResponse {
  steamId: string;
  profile: SteamProfile;
  currency: string;
  totals: {
    games: number;
    /** Games we have a price for (paid or free). */
    priced: number;
    free: number;
    valueNow: number;
    valueFull: number;
    playtimeMinutes: number;
    neverPlayed: number;
    neverPlayedValue: number;
  };
  insights: LibraryInsights;
  games: LibraryGame[];
}

/** A Steam friend, for the "compare with a friend" picker. */
export interface SteamFriend {
  steamId: string;
  name: string;
  avatar: string | null;
}

export interface CompareSide {
  steamId: string;
  /** For short links: the custom URL name, or the SteamID64. */
  handle: string;
  profile: SteamProfile;
  totals: LibraryResponse["totals"];
  persona: { key: string; title: string; line: string };
  topGames: LibraryInsights["topGames"];
}

/** A game in both libraries. */
export interface SharedGame {
  appId: number;
  id: string | null;
  name: string;
  image: string | null;
  minutesA: number;
  minutesB: number;
  reviewPct: number | null;
  onlineCoop: boolean;
  onlinePvp: boolean;
}

/** A game one side loves and the other hasn't played (or doesn't own). */
export interface Recommendation {
  appId: number;
  id: string | null;
  name: string;
  image: string | null;
  minutes: number;
  /** Whether the other side owns it already. */
  owned: boolean;
  priceNow: number | null;
}

export interface CompareResponse {
  currency: string;
  a: CompareSide;
  b: CompareSide;
  /** Games both own. */
  common: number;
  /** Owned by both, playable together online, best-rated first. */
  together: SharedGame[];
  /** Owned and played by both, most shared hours first. */
  bothPlayed: SharedGame[];
  /** What A plays most that B hasn't played, and the other way round. */
  aRecommends: Recommendation[];
  bRecommends: Recommendation[];
  /** Share of tag-hours in common (0-1): how alike their tastes are. */
  tasteMatch: number;
}
