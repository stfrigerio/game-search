import { FEATURES } from "../shared/features.ts";
import type { LibraryGame, LibraryInsights, LibraryResponse, SteamProfile } from "../shared/types.ts";
import { db } from "./db/pool.ts";
import { LIVE } from "./db/schema.ts";
import { fetchOwnedGames, fetchSteamProfile, type OwnedGame } from "./steam-profile.ts";

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface CatalogRow {
  steam_app_id: number;
  id: string;
  name: string;
  image: string | null;
  free: boolean;
  best_price: number | null;
  best_base_price: number | null;
  best_discount: number;
  tags: string[];
  release_date: number | null;
  rating: number;
  review_pct: number;
  review_count: number;
  features: number;
}

const MULTI_BIT = 1 << FEATURES.findIndex((f) => f.key === "multi");

/** Per-game rows and totals from owned games and our catalogue (pure; tested). */
export function buildLibrary(owned: OwnedGame[], catalog: Map<number, CatalogRow>): Pick<LibraryResponse, "totals" | "games"> {
  const games: LibraryGame[] = owned.map((o) => {
    const c = catalog.get(o.appid);
    return {
      appId: o.appid,
      id: c?.id ?? null,
      name: c?.name ?? o.name ?? `App ${o.appid}`,
      image: c?.image ?? null,
      playtimeMinutes: o.playtime_forever ?? 0,
      recentMinutes: o.playtime_2weeks ?? 0,
      free: c?.free ?? false,
      priceNow: c ? (c.free ? 0 : c.best_price) : null,
      priceFull: c ? (c.free ? 0 : (c.best_base_price ?? c.best_price)) : null,
      discountPct: c?.best_discount ?? 0,
      tags: c?.tags ?? [],
      releaseYear: c?.release_date ? new Date(c.release_date * 1000).getUTCFullYear() : null,
      rating: c && c.review_count > 0 ? Math.round(c.rating * 10) / 10 : null,
      reviewPct: c && c.review_count > 0 ? c.review_pct : null,
      reviewCount: c?.review_count ?? 0,
      multiplayer: c ? (c.features & MULTI_BIT) !== 0 : false,
    };
  });
  const totals = { games: games.length, priced: 0, free: 0, valueNow: 0, valueFull: 0, playtimeMinutes: 0, neverPlayed: 0, neverPlayedValue: 0 };
  for (const g of games) {
    totals.playtimeMinutes += g.playtimeMinutes;
    if (g.free) totals.free++;
    if (g.priceNow !== null) {
      totals.priced++;
      totals.valueNow += g.priceNow;
      totals.valueFull += g.priceFull ?? g.priceNow;
    }
    if (g.playtimeMinutes === 0) {
      totals.neverPlayed++;
      totals.neverPlayedValue += g.priceNow ?? 0;
    }
  }
  return { totals, games };
}

const TAGS_PER_GAME = 3;
// Tags that describe nearly everything and would top every chart.
const GENERIC_TAGS = new Set(["singleplayer", "indie", "multiplayer", "great soundtrack", "atmospheric", "2d", "3d", "casual", "early access", "free to play"]);

/** What the profile page charts (pure; tested). */
export function buildInsights(games: LibraryGame[]): LibraryInsights {
  const pick = (g: LibraryGame) => ({ appId: g.appId, id: g.id, name: g.name });
  const played = games.filter((g) => g.playtimeMinutes > 0).sort((a, b) => b.playtimeMinutes - a.playtimeMinutes);
  const total = played.reduce((n, g) => n + g.playtimeMinutes, 0);

  const tagMap = new Map<string, { minutes: number; games: number }>();
  for (const g of played) {
    for (const tag of g.tags.filter((t) => !GENERIC_TAGS.has(t.toLowerCase())).slice(0, TAGS_PER_GAME)) {
      const e = tagMap.get(tag) ?? { minutes: 0, games: 0 };
      e.minutes += g.playtimeMinutes;
      e.games++;
      tagMap.set(tag, e);
    }
  }

  const yearMap = new Map<number, { games: number; minutes: number; unplayed: number }>();
  for (const g of games) {
    if (g.releaseYear === null) continue;
    const e = yearMap.get(g.releaseYear) ?? { games: 0, minutes: 0, unplayed: 0 };
    e.games++;
    e.minutes += g.playtimeMinutes;
    if (g.playtimeMinutes === 0) e.unplayed++;
    yearMap.set(g.releaseYear, e);
  }
  // Fill gaps so the columns read as a continuous timeline.
  const years = [...yearMap.keys()];
  const byYear: LibraryInsights["byYear"] = [];
  if (years.length) {
    for (let y = Math.min(...years); y <= Math.max(...years); y++) byYear.push({ year: y, ...(yearMap.get(y) ?? { games: 0, minutes: 0, unplayed: 0 }) });
  }

  const share = (n: number) => (total ? n / total : 0);
  const top1 = played[0]?.playtimeMinutes ?? 0;
  const next9 = played.slice(1, 10).reduce((n, g) => n + g.playtimeMinutes, 0);

  const rated = played.filter((g) => g.reviewPct !== null);
  const ratedMinutes = rated.reduce((n, g) => n + g.playtimeMinutes, 0);

  return {
    topGames: played.slice(0, 10).map((g) => ({ ...pick(g), minutes: g.playtimeMinutes })),
    byTag: [...tagMap].map(([tag, e]) => ({ tag, ...e })).sort((a, b) => b.minutes - a.minutes).slice(0, 10),
    byYear,
    concentration: { top1: share(top1), next9: share(next9), rest: total ? 1 - share(top1) - share(next9) : 0 },
    recent: games
      .filter((g) => g.recentMinutes > 0)
      .sort((a, b) => b.recentMinutes - a.recentMinutes)
      .slice(0, 8)
      .map((g) => ({ ...pick(g), minutes: g.recentMinutes })),
    unplayedGems: games
      .filter((g) => g.playtimeMinutes === 0 && g.rating !== null && g.reviewCount >= 50)
      .sort((a, b) => b.rating! - a.rating!)
      .slice(0, 10)
      .map((g) => ({ ...pick(g), rating: g.rating!, reviewPct: g.reviewPct!, priceNow: g.priceNow })),
    avgReviewPct: ratedMinutes ? Math.round(rated.reduce((n, g) => n + g.reviewPct! * g.playtimeMinutes, 0) / ratedMinutes) : null,
    multiplayerMinutes: played.filter((g) => g.multiplayer).reduce((n, g) => n + g.playtimeMinutes, 0),
    recentMinutes: games.reduce((n, g) => n + g.recentMinutes, 0),
  };
}

const cache = new Map<string, { at: number; value: Promise<LibraryResponse> }>();
const CACHE_MS = 10 * 60 * 1000;

/** A profile's library, priced and charted. Cached for ten minutes per profile. */
export function getLibrary(steamId: string, key: string): Promise<LibraryResponse> {
  const hit = cache.get(steamId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = loadLibrary(steamId, key);
  value.catch(() => cache.delete(steamId));
  cache.set(steamId, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return value;
}

async function loadLibrary(steamId: string, key: string): Promise<LibraryResponse> {
  const [owned, profile] = await Promise.all([fetchOwnedGames(steamId, key), fetchSteamProfile(steamId, key)]);
  if (owned === null) {
    throw new LibraryError("That library is private. In Steam: Profile → Edit Profile → Privacy Settings → Game details: Public.", 404);
  }
  const [rows, meta] = await Promise.all([
    db().query<CatalogRow>(
      `SELECT g.steam_app_id, g.id, d.name, d.image, g.free, g.best_price, g.best_base_price, g.best_discount,
              d.tags[1:8] AS tags, g.release_date, g.rating, g.review_pct, g.review_count, g.features
         FROM ${LIVE}.games g JOIN ${LIVE}.game_details d USING (id)
        WHERE g.steam_app_id = ANY($1::int[])`,
      [owned.map((o) => o.appid)],
    ),
    db().query<{ value: string }>(`SELECT value FROM ${LIVE}.meta WHERE key = 'currency'`),
  ]);
  const library = buildLibrary(owned, new Map(rows.rows.map((r) => [r.steam_app_id, r])));
  return {
    steamId,
    profile: profile satisfies SteamProfile,
    currency: meta.rows[0]?.value ?? "USD",
    ...library,
    insights: buildInsights(library.games),
  };
}
