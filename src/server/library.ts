import type { LibraryGame, LibraryResponse } from "../shared/types.ts";
import { db } from "./db/pool.ts";
import { LIVE } from "./db/schema.ts";
import { fetchOwnedGames, fetchPlayerSummary, type OwnedGame } from "./steam-profile.ts";

export class LibraryError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface PriceRow {
  steam_app_id: number;
  id: string;
  name: string;
  image: string | null;
  free: boolean;
  best_price: number | null;
  best_base_price: number | null;
  best_discount: number;
}

/** Totals and per-game rows from owned games and our catalogue's prices (pure; tested). */
export function buildLibrary(
  owned: OwnedGame[],
  prices: Map<number, PriceRow>,
): Pick<LibraryResponse, "totals" | "games"> {
  const games: LibraryGame[] = owned.map((o) => {
    const p = prices.get(o.appid);
    return {
      appId: o.appid,
      id: p?.id ?? null,
      name: p?.name ?? o.name ?? `App ${o.appid}`,
      image: p?.image ?? null,
      playtimeMinutes: o.playtime_forever ?? 0,
      lastPlayed: o.rtime_last_played || null,
      free: p?.free ?? false,
      priceNow: p ? (p.free ? 0 : p.best_price) : null,
      priceFull: p ? (p.free ? 0 : (p.best_base_price ?? p.best_price)) : null,
      discountPct: p?.best_discount ?? 0,
    };
  });
  const totals = {
    games: games.length,
    priced: 0,
    free: 0,
    valueNow: 0,
    valueFull: 0,
    playtimeMinutes: 0,
    neverPlayed: 0,
    neverPlayedValue: 0,
  };
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

const cache = new Map<string, { at: number; value: Promise<LibraryResponse> }>();
const CACHE_MS = 10 * 60 * 1000;

/** A profile's library, priced from the catalogue. Cached for ten minutes per profile. */
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
  const [owned, profile] = await Promise.all([
    fetchOwnedGames(steamId, key),
    fetchPlayerSummary(steamId, key).catch(() => null),
  ]);
  if (owned === null) {
    throw new LibraryError(
      "That library is private. In Steam: Profile → Edit Profile → Privacy Settings → Game details: Public.",
      404,
    );
  }
  const [rows, meta] = await Promise.all([
    db().query<PriceRow>(
      `SELECT g.steam_app_id, g.id, d.name, d.image, g.free, g.best_price, g.best_base_price, g.best_discount
         FROM ${LIVE}.games g JOIN ${LIVE}.game_details d USING (id)
        WHERE g.steam_app_id = ANY($1::int[])`,
      [owned.map((o) => o.appid)],
    ),
    db().query<{ value: string }>(`SELECT value FROM ${LIVE}.meta WHERE key = 'currency'`),
  ]);
  const prices = new Map(rows.rows.map((r) => [r.steam_app_id, r]));
  return {
    steamId,
    profileName: profile?.name ?? null,
    avatar: profile?.avatar ?? null,
    currency: meta.rows[0]?.value ?? "USD",
    ...buildLibrary(owned, prices),
  };
}
