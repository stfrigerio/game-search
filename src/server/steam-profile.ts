import { USER_AGENT, fetchJson } from "./http.ts";

const STEAM_ID64 = /^7656119\d{10}$/;
const VANITY = /^[A-Za-z0-9_-]{2,32}$/;

/**
 * Turn whatever the user pasted (profile URL, custom URL name or SteamID64)
 * into a SteamID64. Returns null when it can't be resolved.
 */
export async function resolveSteamId(input: string): Promise<string | null> {
  const text = input.trim().replace(/\/+$/, "");
  const profiles = text.match(/steamcommunity\.com\/profiles\/(\d+)/);
  if (profiles) return STEAM_ID64.test(profiles[1]) ? profiles[1] : null;
  if (STEAM_ID64.test(text)) return text;

  const vanity = text.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] ?? text;
  if (!VANITY.test(vanity)) return null;
  // The profile's XML view is public and maps a custom URL to its SteamID64.
  const res = await fetch(`https://steamcommunity.com/id/${vanity}/?xml=1`, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return (await res.text()).match(/<steamID64>(\d{17})<\/steamID64>/)?.[1] ?? null;
}

interface WishlistResponse {
  response: { items?: { appid: number; priority: number; date_added: number }[] };
}

/** App ids on a user's Steam wishlist, in their priority order. Empty if private. */
export async function fetchWishlist(steamId: string): Promise<number[]> {
  const res = await fetchJson<WishlistResponse>(
    `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?steamid=${steamId}`,
    { retries: 1 },
  );
  // Priority 0 means "not ranked yet"; those go last.
  const rank = (p: number) => p || Number.MAX_SAFE_INTEGER;
  return (res.response.items ?? []).sort((a, b) => rank(a.priority) - rank(b.priority)).map((i) => i.appid);
}
