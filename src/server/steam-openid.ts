import { USER_AGENT } from "./http.ts";

// "Sign in through Steam" is OpenID 2.0: we send the visitor to Steam, Steam sends
// them back with their SteamID64 in a signed response, and we ask Steam to confirm
// the signature. No password or token ever reaches us, and nothing is stored: the
// verified id just goes into the page's URL.

const STEAM_OPENID = "https://steamcommunity.com/openid/login";
const NS = "http://specs.openid.net/auth/2.0";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(7656119\d{10})$/;

/** Pages that may follow a sign-in, and the URL each lands on. */
export const DESTINATIONS = {
  library: (id: string) => `/u/${id}?me=1`,
  list: (id: string) => `/?view=list&steam=${id}`,
} as const;
export type Destination = keyof typeof DESTINATIONS;

export function isDestination(v: unknown): v is Destination {
  return typeof v === "string" && Object.hasOwn(DESTINATIONS, v);
}

/** Where to send the visitor to sign in; Steam returns them to `returnTo`. */
export function steamLoginUrl(site: string, next: Destination): string {
  const params = new URLSearchParams({
    "openid.ns": NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": `${site}/api/auth/steam/return?next=${next}`,
    "openid.realm": site,
    "openid.identity": `${NS}/identifier_select`,
    "openid.claimed_id": `${NS}/identifier_select`,
  });
  return `${STEAM_OPENID}?${params}`;
}

/**
 * Check Steam's response and return the SteamID64, or null if it isn't a valid,
 * Steam-signed answer meant for this site. `fetchImpl` is for tests.
 */
export async function verifySteamLogin(
  query: Record<string, unknown>,
  site: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const get = (k: string) => (typeof query[k] === "string" ? (query[k] as string) : "");
  if (get("openid.mode") !== "id_res" || get("openid.op_endpoint") !== STEAM_OPENID) return null;
  // The response must be addressed to us, not replayed from another site.
  if (!get("openid.return_to").startsWith(`${site}/api/auth/steam/return`)) return null;
  const id = get("openid.claimed_id").match(CLAIMED_ID)?.[1];
  if (!id || get("openid.identity") !== get("openid.claimed_id")) return null;

  // Ask Steam whether it really signed this: echo every openid.* field back.
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith("openid.") && typeof v === "string") body.set(k, v);
  body.set("openid.mode", "check_authentication");
  const res = await fetchImpl(STEAM_OPENID, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  return /^is_valid\s*:\s*true\s*$/m.test(await res.text()) ? id : null;
}
