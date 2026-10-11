import { USER_AGENT } from "../http.ts";

/**
 * SteamSpy's "all" listing: ~90 pages of 1,000 apps, most-owned first. It has no
 * key but asks for slow requests, so pages are fetched one at a time with a pause.
 * We use it for yesterday's peak concurrent players and the owners estimate.
 */
const PAUSE_MS = 3000;
const MAX_PAGES = 150;

interface SpyApp {
  appid: number;
  ccu?: number;
  owners?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One page, or null when SteamSpy answers with something that isn't JSON. */
async function fetchPage(page: number): Promise<SpyApp[] | null> {
  const res = await fetch(`https://steamspy.com/api.php?request=all&page=${page}`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`SteamSpy HTTP ${res.status}`);
  try {
    const body = JSON.parse(await res.text()) as Record<string, SpyApp> | [];
    return Array.isArray(body) ? [] : Object.values(body);
  } catch {
    return null;
  }
}

/**
 * Stream SteamSpy pages into `onPage`. Returns how many apps were seen; throws if
 * SteamSpy gave us nothing at all.
 */
export async function crawlSteamSpy(
  onPage: (apps: { appid: number; peakPlayers: number; owners: string }[]) => Promise<void>,
  onProgress?: (msg: string) => void,
  maxPages = MAX_PAGES,
): Promise<number> {
  let seen = 0;
  for (let page = 0; page < maxPages; page++) {
    if (page > 0) await sleep(PAUSE_MS);
    onProgress?.(`SteamSpy: page ${page + 1}`);
    let apps: SpyApp[] | null = null;
    for (let attempt = 0; attempt < 3 && apps === null; attempt++) {
      if (attempt > 0) await sleep(15_000 * attempt);
      try {
        apps = await fetchPage(page);
      } catch (err) {
        if (attempt === 2 && !seen) throw err;
      }
    }
    // Past the last page SteamSpy returns an empty list or an error text; either way we're done.
    if (!apps?.length) break;
    await onPage(apps.map((a) => ({ appid: a.appid, peakPlayers: a.ccu ?? 0, owners: a.owners ?? "" })));
    seen += apps.length;
  }
  if (!seen) throw new Error("SteamSpy returned no data");
  return seen;
}
