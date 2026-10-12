import type pg from "pg";
import type { Game } from "../shared/types.ts";
import { db } from "./db/pool.ts";
import { mapLimit } from "./http.ts";
import { deleteGames, fullGame, insertGames, rowToGame, type GameRow } from "./db/rows.ts";
import { createCatalogIndexes, createCatalogTables, LIVE, migrateBase, SCHEMA_VERSION, STAGING } from "./db/schema.ts";
import { absorb, TitleMatcher } from "./merge.ts";
import { crawlSteam, OTHER_SOURCES, type CrawlOptions } from "./sources/index.ts";
import { currentPlayers, topPeaks } from "./sources/steam-players.ts";
import { crawlSteamSpy } from "./sources/steamspy.ts";
import { applySpecs } from "./specs.ts";

// Only one crawl at a time, across processes.
const LOCK_ID = 727_274_001;

export interface CrawlConfig {
  country: string;
  currency: string;
  /** Cap games per store, for quick local runs. */
  limit?: number;
  skipSteamSpy?: boolean;
}

/** Tag ids are assigned as tags are first seen (case-insensitive). */
function tagRegistry() {
  const tags = new Map<string, { id: number; name: string }>();
  const tagId = (name: string) => {
    const key = name.toLowerCase();
    let tag = tags.get(key);
    if (!tag) tags.set(key, (tag = { id: tags.size + 1, name }));
    return tag.id;
  };
  return { tags, tagId };
}

/** Progress shown on the site while a crawl runs. Throttled, best effort. */
function statusReporter() {
  let last = 0;
  return (progress: string, force = false) => {
    if (!force && Date.now() - last < 3000) return;
    last = Date.now();
    console.log(progress);
    db()
      .query("UPDATE public.crawl_status SET progress = $1 WHERE id = 1", [progress])
      .catch(() => {});
  };
}

async function withCrawlLock<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db().connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS ok", [LOCK_ID]);
    if (!rows[0].ok) throw new Error("Another crawl is already running");
    try {
      return await fn(client);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

async function setStatus(state: "running" | "idle" | "failed", error: string | null = null) {
  await db().query(
    `UPDATE public.crawl_status
        SET state = $1,
            error = $2,
            started_at = CASE WHEN $1 = 'running' THEN now() ELSE started_at END,
            finished_at = CASE WHEN $1 = 'running' THEN NULL ELSE now() END,
            progress = CASE WHEN $1 = 'running' THEN 'Starting' ELSE NULL END
      WHERE id = 1`,
    [state, error],
  );
}

/**
 * Rebuild the whole catalogue into a staging schema and swap it in at the end.
 * If anything fails, the live catalogue is left untouched. Memory stays low: Steam
 * pages are written as they arrive and only a small title index is kept for
 * matching other stores against Steam.
 */
export async function crawlCatalog(config: CrawlConfig): Promise<void> {
  await withCrawlLock(async (client) => {
    await migrateBase(client); // idempotent; makes a fresh database work without a separate step
    await setStatus("running");
    const report = statusReporter();
    const started = Date.now();
    try {
      await client.query(`DROP SCHEMA IF EXISTS ${STAGING} CASCADE`);
      await createCatalogTables(client, STAGING);

      const { tags, tagId } = tagRegistry();

      const opts: CrawlOptions = { country: config.country, currency: config.currency, limit: config.limit, onProgress: report };
      const matcher = new TitleMatcher();
      const steamCount = await crawlSteam(opts, async (games) => {
        await insertGames(client, STAGING, games, tagId);
        games.forEach((g) => matcher.add(g));
      });
      matcher.commit();
      report(`Steam: ${steamCount} games stored`, true);

      for (const [store, crawl] of Object.entries(OTHER_SOURCES)) {
        const games = await crawl!(opts);
        const merged = await mergeIntoStaging(client, games, matcher, tagId);
        report(`${store}: ${games.length} games, ${merged} merged into existing games`, true);
      }

      await addPlayerCounts(client, STAGING, report, config);

      report("Building indexes", true);
      await finishStaging(client, [...tags.values()], config.currency);
      await swapStagingIn(client);

      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${LIVE}.games`);
      console.log(`Catalogue refreshed: ${rows[0].n} games in ${Math.round((Date.now() - started) / 1000)}s`);
      await setStatus("idle");
    } catch (err) {
      await setStatus("failed", String(err)).catch(() => {});
      throw err;
    }
  });
}

/** Tag table, metadata, indexes and statistics for a fully loaded staging schema. */
export async function finishStaging(client: pg.ClientBase, tags: { id: number; name: string }[], currency: string) {
  await client.query(`INSERT INTO ${STAGING}.tags (id, name) SELECT * FROM unnest($1::int[], $2::text[])`, [
    tags.map((t) => t.id),
    tags.map((t) => t.name),
  ]);
  await client.query(`
    UPDATE ${STAGING}.tags t SET count = c.n
      FROM (SELECT unnest(tag_ids) AS id, count(*) AS n FROM ${STAGING}.games GROUP BY 1) c
     WHERE c.id = t.id`);
  await client.query(
    `INSERT INTO ${STAGING}.meta (key, value) VALUES
       ('updated_at', to_jsonb(now())),
       ('currency', to_jsonb($1::text)),
       ('schema_version', to_jsonb($2::int)),
       ('store_counts', coalesce((SELECT jsonb_object_agg(s, n) FROM (
          SELECT unnest(store_ids) AS s, count(*) AS n FROM ${STAGING}.games GROUP BY 1) x), '{}'::jsonb))`,
    [currency, SCHEMA_VERSION],
  );
  await applySpecs(STAGING, client);
  await createCatalogIndexes(client, STAGING);
  await client.query(`ANALYZE ${STAGING}.games`);
  await client.query(`ANALYZE ${STAGING}.game_details`);
}

/**
 * Replace the live catalogue with the staging one. It's a couple of renames in one
 * transaction: searches see either the old catalogue or the new one, never a mix.
 */
export async function swapStagingIn(client: pg.ClientBase) {
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${LIVE}`);
  await client.query("BEGIN");
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${LIVE}_old CASCADE`);
    await client.query(`ALTER SCHEMA ${LIVE} RENAME TO ${LIVE}_old`);
    await client.query(`ALTER SCHEMA ${STAGING} RENAME TO ${LIVE}`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
  await client.query(`DROP SCHEMA IF EXISTS ${LIVE}_old CASCADE`);
}

/** Load a given list of games as the live catalogue (tests and one-off imports). */
export async function replaceCatalog(games: Game[], currency = "USD") {
  const client = await db().connect();
  try {
    await migrateBase(client);
    await client.query(`DROP SCHEMA IF EXISTS ${STAGING} CASCADE`);
    await createCatalogTables(client, STAGING);
    const { tags, tagId } = tagRegistry();
    await insertGames(client, STAGING, games, tagId);
    await finishStaging(client, [...tags.values()], currency);
    await swapStagingIn(client);
  } finally {
    client.release();
  }
}

/** Merge another store's games into the staged catalogue. Returns how many matched. */
async function mergeIntoStaging(
  client: pg.ClientBase,
  games: Game[],
  matcher: TitleMatcher,
  tagId: (tag: string) => number,
): Promise<number> {
  const targets = new Map<string, Game[]>(); // existing game id -> listings to fold in
  const fresh: Game[] = [];
  for (const g of games) {
    const target = matcher.match(g);
    if (!target) fresh.push(g);
    else targets.set(target, [...(targets.get(target) ?? []), g]);
  }

  const ids = [...targets.keys()];
  for (let k = 0; k < ids.length; k += 500) {
    const chunk = ids.slice(k, k + 500);
    const { rows } = await client.query<GameRow>(`SELECT * FROM ${fullGame(STAGING)} WHERE id = ANY($1)`, [chunk]);
    const merged = rows.map((r) => {
      const game = rowToGame(r);
      for (const other of targets.get(game.id)!) absorb(game, other);
      return game;
    });
    await deleteGames(client, STAGING, chunk);
    await insertGames(client, STAGING, merged, tagId);
  }

  await insertGames(client, STAGING, fresh, tagId);
  fresh.forEach((g) => matcher.add(g));
  matcher.commit();
  return ids.length;
}

/** Fill peak players / owners from SteamSpy; if it fails, carry over the live numbers. */
async function addPlayerCounts(
  client: pg.ClientBase,
  schema: string,
  report: (msg: string, force?: boolean) => void,
  config: Pick<CrawlConfig, "skipSteamSpy" | "limit">,
) {
  try {
    if (config.skipSteamSpy) throw new Error("skipped (SKIP_STEAMSPY=1)");
    const n = await crawlSteamSpy(
      async (apps) => {
        await client.query(
          `WITH v AS (SELECT * FROM unnest($1::int[], $2::int[], $3::text[]) AS v(appid, peak, owners)),
                upd AS (UPDATE ${schema}.games g SET peak_players = v.peak FROM v WHERE g.steam_app_id = v.appid
                        RETURNING g.id, v.owners)
           UPDATE ${schema}.game_details d SET owners = NULLIF(upd.owners, '') FROM upd WHERE d.id = upd.id`,
          [apps.map((a) => a.appid), apps.map((a) => a.peakPlayers), apps.map((a) => a.owners)],
        );
      },
      (msg) => report(msg),
      config.limit ? 2 : undefined,
    );
    report(`SteamSpy: ${n} apps`, true);
  } catch (err) {
    if (schema === LIVE) throw err;
    report(`SteamSpy unavailable, keeping previous player counts: ${String(err)}`, true);
    try {
      await client.query(`UPDATE ${schema}.games s SET peak_players = l.peak_players FROM ${LIVE}.games l WHERE l.id = s.id`);
      await client.query(`UPDATE ${schema}.game_details s SET owners = l.owners FROM ${LIVE}.game_details l WHERE l.id = s.id`);
    } catch (copyErr) {
      // The live catalogue may have an older layout; player counts just stay empty until next time.
      report(`Couldn't carry over player counts: ${String(copyErr)}`, true);
    }
  }
  try {
    await fillPlayerGaps(client, schema, report, config.limit ? 50 : undefined);
  } catch (err) {
    report(`Steam player counts unavailable: ${String(err)}`, true);
  }
}

// Games with fewer reviews than this and no SteamSpy number are left without one.
const GAP_MIN_REVIEWS = 100;

/**
 * Ask Steam itself about games SteamSpy has no players for, most reviewed first. Steam
 * only tells the count right now, which runs below the day's peak; the 100 most played
 * games get their real peak from Steam's chart.
 */
async function fillPlayerGaps(client: pg.ClientBase, schema: string, report: (msg: string, force?: boolean) => void, limit?: number) {
  const save = (apps: number[], players: number[]) =>
    client.query(
      `UPDATE ${schema}.games g SET peak_players = v.players
         FROM unnest($1::int[], $2::int[]) AS v(appid, players) WHERE g.steam_app_id = v.appid`,
      [apps, players],
    );
  const peaks = await topPeaks();
  await save([...peaks.keys()], [...peaks.values()]);

  const { rows } = await client.query<{ appid: number }>(
    `SELECT steam_app_id AS appid FROM ${schema}.games
      WHERE steam_app_id IS NOT NULL AND coalesce(peak_players, 0) = 0 AND review_count >= $1 AND NOT coming_soon
      ORDER BY review_count DESC LIMIT $2`,
    [GAP_MIN_REVIEWS, limit ?? null],
  );
  let done = 0;
  let found = 0;
  let failed = 0;
  const BATCH = 400;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const counts = await mapLimit(batch, 4, async ({ appid }) => {
      // A few lost answers don't matter; Steam turning us away does.
      if (failed > 50) return null;
      try {
        return await currentPlayers(appid);
      } catch {
        failed++;
        return null;
      }
    });
    const known = batch.flatMap((r, j) => (counts[j] === null ? [] : [{ appid: r.appid, players: counts[j]! }]));
    if (known.length) await save(known.map((k) => k.appid), known.map((k) => k.players));
    found += known.length;
    done += batch.length;
    report(`Steam players: ${done}/${rows.length}`);
    if (failed > 50) throw new Error(`Steam stopped answering after ${done} games`);
  }
  report(`Steam players: ${found} of ${rows.length} games SteamSpy had nothing for`, true);
}

/** Refresh only player counts, directly on the live catalogue. */
export async function refreshPlayerCounts(): Promise<void> {
  await withCrawlLock(async (client) => {
    await addPlayerCounts(client, LIVE, statusReporter(), {});
  });
}
