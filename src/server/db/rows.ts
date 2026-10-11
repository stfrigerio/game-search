import type pg from "pg";
import type { PowerLevel } from "../../shared/power.ts";
import type { DeckCompat, Game, GameSummary, StoreId, StoreListing } from "../../shared/types.ts";
import { contentMask, dealScore, featureMask, languageMask, summarize } from "../derive.ts";
import { titleKey } from "../merge.ts";

const GAME_COLUMNS = [
  "id", "search_name", "people", "people_list", "tag_ids", "release_date", "coming_soon", "early_access", "platforms", "deck",
  "features", "langs", "audio", "content", "peak_players", "steam_app_id", "store_ids", "review_count", "review_pct",
  "rating", "best_price", "best_base_price", "best_discount", "best_discount_ends", "best_store", "free", "deal_score",
  "power", "power_known",
] as const;

const DETAIL_COLUMNS = [
  "id", "name", "image", "developers", "publishers", "tags", "description", "categories", "languages",
  "audio_languages", "content_descriptors", "owners", "stores",
] as const;

/** Values for `games` and `game_details`, in the column orders above. */
function gameValues(g: Game, tagId: (tag: string) => number): [unknown[], unknown[]] {
  const s = summarize(g);
  const platforms = (g.platforms.windows ? 1 : 0) | (g.platforms.mac ? 2 : 0) | (g.platforms.linux ? 4 : 0);
  return [
    [
      g.id,
      titleKey(g.name),
      titleKey([...g.developers, ...g.publishers].join(" | ")),
      [...new Set([...g.developers, ...g.publishers].map((n) => n.toLowerCase()))],
      g.tags.map(tagId),
      g.releaseDate,
      g.comingSoon,
      g.earlyAccess,
      platforms,
      g.deck,
      featureMask(g.categories),
      languageMask(g.languages),
      languageMask(g.audioLanguages),
      contentMask(g.contentDescriptors),
      g.peakPlayers,
      g.steamAppId,
      s.stores,
      s.reviewCount,
      s.reviewPct,
      s.rating,
      s.bestPrice,
      s.bestBasePrice,
      s.bestDiscountPct,
      s.bestDiscountEnds,
      s.bestStore,
      s.free,
      dealScore(s),
      // The estimate; finishStaging overwrites it where requirements have been read.
      s.power,
      false,
    ],
    [
      g.id,
      g.name,
      g.image,
      g.developers,
      g.publishers,
      g.tags,
      g.description,
      g.categories,
      g.languages,
      g.audioLanguages,
      g.contentDescriptors,
      g.owners,
      JSON.stringify(g.stores),
    ],
  ];
}

const BATCH = 500; // 29 columns x 500 rows stays well under Postgres' 65k parameter limit

async function insertRows(client: pg.ClientBase, table: string, columns: readonly string[], rows: unknown[][]) {
  const params: unknown[] = [];
  const tuples = rows.map((values) => `(${values.map((v) => (params.push(v), `$${params.length}`)).join(",")})`);
  await client.query(`INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")}`, params);
}

/** Insert games (both tables) in multi-row batches. */
export async function insertGames(client: pg.ClientBase, schema: string, games: Game[], tagId: (tag: string) => number) {
  for (let k = 0; k < games.length; k += BATCH) {
    const values = games.slice(k, k + BATCH).map((g) => gameValues(g, tagId));
    await insertRows(client, `${schema}.games`, GAME_COLUMNS, values.map((v) => v[0]));
    await insertRows(client, `${schema}.game_details`, DETAIL_COLUMNS, values.map((v) => v[1]));
  }
}

/** Delete games from both tables. */
export async function deleteGames(client: pg.ClientBase, schema: string, ids: string[]) {
  await client.query(`DELETE FROM ${schema}.games WHERE id = ANY($1)`, [ids]);
  await client.query(`DELETE FROM ${schema}.game_details WHERE id = ANY($1)`, [ids]);
}

/** FROM clause joining both tables as `g` and `d`; select `g.*, d.*` for a full GameRow. */
export const fullGame = (schema: string) => `${schema}.games g JOIN ${schema}.game_details d USING (id)`;

/** Columns (from `g` = games, `d` = game_details) needed to build a GameSummary. */
export const SUMMARY_COLUMNS =
  "g.id, d.name, d.image, d.tags[1:8] AS tags, d.developers, g.release_date, g.coming_soon, g.early_access, " +
  "g.platforms, g.deck, g.review_count, g.review_pct, g.rating, g.best_price, g.best_base_price, g.best_discount, " +
  "g.best_discount_ends, g.best_store, g.peak_players, g.free, g.store_ids, g.power, g.power_known";

export interface GameRow {
  id: string;
  name: string;
  image: string | null;
  tags: string[];
  developers: string[];
  publishers: string[];
  description: string;
  release_date: number | null;
  coming_soon: boolean;
  early_access: boolean;
  platforms: number;
  deck: number;
  categories: number[];
  languages: number[];
  audio_languages: number[];
  content_descriptors: number[];
  features: number;
  langs: number;
  audio: number;
  peak_players: number | null;
  owners: string | null;
  steam_app_id: number | null;
  stores: StoreListing[];
  store_ids: StoreId[];
  review_count: number;
  review_pct: number;
  rating: number;
  best_price: number | null;
  best_base_price: number | null;
  best_discount: number;
  best_discount_ends: number | null;
  best_store: StoreId | null;
  free: boolean;
  power: number;
  power_known: boolean;
}

const platformsOf = (bits: number) => ({ windows: (bits & 1) !== 0, mac: (bits & 2) !== 0, linux: (bits & 4) !== 0 });

export function rowToSummary(r: GameRow): GameSummary {
  return {
    id: r.id,
    name: r.name,
    image: r.image,
    tags: r.tags.slice(0, 8),
    developers: r.developers,
    releaseDate: r.release_date,
    comingSoon: r.coming_soon,
    earlyAccess: r.early_access,
    platforms: platformsOf(r.platforms),
    deck: r.deck as DeckCompat,
    reviewCount: r.review_count,
    reviewPct: r.review_pct,
    rating: Math.round(r.rating * 10) / 10,
    bestPrice: r.best_price,
    bestBasePrice: r.best_base_price,
    bestDiscountPct: r.best_discount,
    bestDiscountEnds: r.best_discount_ends,
    bestStore: r.best_store,
    peakPlayers: r.peak_players,
    free: r.free,
    stores: r.store_ids,
    power: r.power as PowerLevel,
    powerKnown: r.power_known,
  };
}

/** A full row (SELECT *) back into the Game it was built from. */
export function rowToGame(r: GameRow): Game {
  return {
    id: r.id,
    name: r.name,
    developers: r.developers,
    publishers: r.publishers,
    tags: r.tags,
    description: r.description,
    image: r.image,
    releaseDate: r.release_date,
    comingSoon: r.coming_soon,
    earlyAccess: r.early_access,
    platforms: platformsOf(r.platforms),
    deck: r.deck as DeckCompat,
    categories: r.categories,
    languages: r.languages,
    audioLanguages: r.audio_languages,
    contentDescriptors: r.content_descriptors,
    peakPlayers: r.peak_players,
    owners: r.owners,
    steamAppId: r.steam_app_id,
    stores: r.stores,
  };
}
