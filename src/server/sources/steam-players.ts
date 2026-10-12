import { USER_AGENT } from "../http.ts";

// Steam's own player numbers, no API key needed. SteamSpy has nothing for most games
// released since 2025 (and for a few big ones, Dota 2 among them), so these fill the gaps.
const API = "https://api.steampowered.com";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(url: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
}

/** Today's peak for the 100 most played games, by app id. */
export async function topPeaks(): Promise<Map<number, number>> {
  const res = await get(`${API}/ISteamChartsService/GetGamesByConcurrentPlayers/v1/`);
  if (!res.ok) throw new Error(`Steam charts HTTP ${res.status}`);
  const body = (await res.json()) as { response?: { ranks?: { appid: number; peak_in_game: number }[] } };
  return new Map((body.response?.ranks ?? []).map((r) => [r.appid, r.peak_in_game]));
}

/**
 * How many people are in a game right now. Null when Steam doesn't say (it answers
 * 404 for apps without stats); throws when Steam is refusing or failing.
 */
export async function currentPlayers(appid: number): Promise<number | null> {
  for (let attempt = 0; ; attempt++) {
    const res = await get(`${API}/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`);
    if (res.ok) {
      const body = (await res.json()) as { response?: { player_count?: number; result?: number } };
      return body.response?.result === 1 ? (body.response.player_count ?? null) : null;
    }
    if (res.status === 404) return null;
    if (attempt === 2) throw new Error(`Steam players HTTP ${res.status}`);
    await sleep(5000 * 2 ** attempt);
  }
}
