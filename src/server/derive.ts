import { CONTENT_FILTERS, FEATURES, LANGUAGES } from "../shared/features.ts";
import type { Game, GameSummary, StoreListing } from "../shared/types.ts";
import { estimateLevel } from "./power.ts";

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
    // An estimate; the catalogue replaces it with the level read from requirements.
    power: estimateLevel(game),
    powerKnown: false,
  };
}

/** Discount weighted by quality: a 50% cut on a great game beats 90% off a bad one. */
export function dealScore(s: GameSummary): number {
  return s.bestDiscountPct > 0 && s.reviewCount >= 10 ? s.bestDiscountPct * Math.max(0, s.rating - 50) : 0;
}

// Bitmasks are stored in Postgres int4 columns, so they are kept as signed 32-bit
// values (`| 0`); bit 31 makes the number negative, which bitwise SQL handles fine.

const CATEGORY_BITS = new Map<number, number>();
FEATURES.forEach((f, bit) => {
  for (const c of f.categories) CATEGORY_BITS.set(c, (CATEGORY_BITS.get(c) ?? 0) | (1 << bit));
});
const DESCRIPTOR_BITS = new Map<number, number>();
CONTENT_FILTERS.forEach((c, bit) => {
  for (const d of c.descriptors) DESCRIPTOR_BITS.set(d, (DESCRIPTOR_BITS.get(d) ?? 0) | (1 << bit));
});

/** Bit i set = the game has FEATURES[i]. */
export function featureMask(categories: number[]): number {
  let m = 0;
  for (const c of categories) m |= CATEGORY_BITS.get(c) ?? 0;
  return m | 0;
}

/** Bit = Steam ELanguage id. */
export function languageMask(ids: number[]): number {
  let m = 0;
  for (const id of ids) if (id >= 0 && id < 31) m |= 1 << id;
  return m | 0;
}

/** Bit i set = the game has CONTENT_FILTERS[i] content. */
export function contentMask(descriptors: number[]): number {
  let m = 0;
  for (const d of descriptors) m |= DESCRIPTOR_BITS.get(d) ?? 0;
  return m;
}

export function featureKeysOf(mask: number): string[] {
  return FEATURES.filter((_, bit) => (mask & (1 << bit)) !== 0).map((f) => f.key);
}

export function languagesOf(langs: number, audio: number): { code: string; audio: boolean }[] {
  return LANGUAGES.filter((l) => (langs & (1 << l.id)) !== 0).map((l) => ({
    code: l.code,
    audio: (audio & (1 << l.id)) !== 0,
  }));
}
