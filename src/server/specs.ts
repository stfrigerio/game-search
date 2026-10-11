import type { Specs } from "../shared/power.ts";
import { db } from "./db/pool.ts";
import { LIVE } from "./db/schema.ts";
import { USER_AGENT } from "./http.ts";
import { isFlat, levelFromSpecs, parseRequirements } from "./power.ts";

/**
 * System requirements (minimum and recommended) read from Steam, in `public.specs`. Unlike the catalogue
 * this table is not rebuilt by a crawl: Steam only gives requirements one game at a
 * time and allows about 200 such requests every five minutes, so the whole catalogue
 * takes days and each game is asked about once. Every crawl then copies the levels
 * into its new catalogue (see finishStaging).
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let epoch = 0;
/** Goes up after each batch of newly read requirements; search caches keyed on it then start over. */
export const specsEpoch = () => epoch;

interface SpecRow {
  ram: number | null;
  vram: number | null;
  disk: number | null;
  gpu: number | null;
  gpu_text: string;
  rec_gpu: number | null;
  rec_vram: number | null;
  rec_gpu_text: string;
}

/** What we read for a Steam app; null when it was not read or said nothing usable. */
export async function getSpecs(appid: number): Promise<Specs | null> {
  const { rows } = await db().query<SpecRow>(
    "SELECT ram, vram, disk, gpu, gpu_text, rec_gpu, rec_vram, rec_gpu_text FROM public.specs WHERE app_id = $1",
    [appid],
  );
  const r = rows[0];
  if (!r || (r.ram === null && r.vram === null && r.disk === null && r.gpu === null && !r.gpu_text && r.rec_gpu === null && !r.rec_gpu_text)) return null;
  return { ram: r.ram, vram: r.vram, disk: r.disk, gpu: r.gpu, gpuText: r.gpu_text, recGpu: r.rec_gpu, recVram: r.rec_vram, recGpuText: r.rec_gpu_text };
}

/** Remember what an app's requirements say (null = nothing usable) and move the game to that level. */
export async function saveSpecs(appid: number, specs: Specs | null): Promise<void> {
  let level: number | null = null;
  if (specs) {
    // Tags and age settle the requirements that land between light and medium.
    const { rows } = await db().query<{ tags: string[]; release_date: number | null }>(
      `SELECT d.tags, g.release_date FROM ${LIVE}.games g JOIN ${LIVE}.game_details d USING (id) WHERE g.steam_app_id = $1`,
      [appid],
    );
    const game = rows[0];
    level = levelFromSpecs(specs, {
      flat: game ? isFlat(game.tags) : false,
      year: game?.release_date ? new Date(game.release_date * 1000).getUTCFullYear() : null,
    });
  }
  await db().query(
    `INSERT INTO public.specs (app_id, ram, vram, disk, gpu, gpu_text, level, rec_gpu, rec_vram, rec_gpu_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (app_id) DO UPDATE SET ram = $2, vram = $3, disk = $4, gpu = $5, gpu_text = $6, level = $7,
       rec_gpu = $8, rec_vram = $9, rec_gpu_text = $10, read_at = now()`,
    [appid, specs?.ram ?? null, specs?.vram ?? null, specs?.disk ?? null, specs?.gpu ?? null, specs?.gpuText ?? "", level,
     specs?.recGpu ?? null, specs?.recVram ?? null, specs?.recGpuText ?? ""],
  );
  if (level) await db().query(`UPDATE ${LIVE}.games SET power = $2, power_known = true WHERE steam_app_id = $1`, [appid, level]);
}

/** Copy every level we have read into a catalogue's games. Cheap when there is nothing new. */
export async function applySpecs(schema: string, client: { query: (sql: string) => Promise<unknown> } = db()): Promise<void> {
  await client.query(
    `UPDATE ${schema}.games g SET power = s.level, power_known = true
       FROM public.specs s
      WHERE s.app_id = g.steam_app_id AND s.level IS NOT NULL AND (NOT g.power_known OR g.power <> s.level)`,
  );
}

/**
 * Ask Steam about one app. "wait" means Steam says we are going too fast; undefined
 * means the request failed for another reason and is worth another try later.
 */
async function fetchSpecs(appid: number): Promise<Specs | null | undefined | "wait"> {
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&filters=basic`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429 || res.status === 403) return "wait";
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, { data?: { pc_requirements?: { minimum?: string; recommended?: string } | [] } }> | null;
    const entry = body?.[appid];
    if (!entry) return undefined;
    // Not sold in our region, or delisted: nothing to read, and no point asking again.
    const req = entry.data?.pc_requirements;
    if (!req || Array.isArray(req)) return null;
    return req.minimum || req.recommended ? parseRequirements(req.minimum ?? "", req.recommended ?? "") : null;
  } catch {
    return undefined;
  }
}

/**
 * Read requirements forever in the background, most reviewed games first, pausing
 * `pauseMs` between requests. Runs inside the web server: it is one small request
 * every couple of seconds.
 */
export async function readSpecsForever(pauseMs: number): Promise<never> {
  const failed = new Set<number>(); // retried after a restart
  for (;;) {
    let queue: number[] = [];
    try {
      // A crawl may have swapped in a catalogue built before the latest answers.
      await applySpecs(LIVE);
      const { rows } = await db().query<{ appid: number }>(
        `SELECT g.steam_app_id AS appid
           FROM ${LIVE}.games g LEFT JOIN public.specs s ON s.app_id = g.steam_app_id
          WHERE g.steam_app_id IS NOT NULL AND s.app_id IS NULL AND g.steam_app_id <> ALL($1::int[])
          ORDER BY g.review_count DESC LIMIT 200`,
        [[...failed]],
      );
      queue = rows.map((r) => r.appid);
    } catch (err) {
      console.warn("Requirements: could not read the queue:", String(err));
    }
    if (!queue.length) {
      await sleep(10 * 60_000);
      continue;
    }
    for (const appid of queue) {
      const specs = await fetchSpecs(appid);
      if (specs === "wait") {
        await sleep(6 * 60_000);
        break;
      }
      if (specs === undefined) failed.add(appid);
      else await saveSpecs(appid, specs).catch((err) => console.warn("Requirements: could not save:", String(err)));
      await sleep(pauseMs);
    }
    epoch++;
  }
}
