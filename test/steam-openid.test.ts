import { describe, expect, it } from "vitest";
import { steamLoginUrl, verifySteamLogin } from "../src/server/steam-openid.ts";

const SITE = "https://gamesearch.example";
const ID = "76561198006409530";

function response(overrides: Record<string, string> = {}) {
  return {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${ID}`,
    "openid.return_to": `${SITE}/api/auth/steam/return?next=library`,
    "openid.response_nonce": "2026-10-19T10:00:00Zabc",
    "openid.assoc_handle": "1234567890",
    "openid.signed": "signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "c2ln",
    next: "library",
    ...overrides,
  };
}

/** A stand-in for Steam's check_authentication endpoint. */
function steam(valid: boolean) {
  const calls: URLSearchParams[] = [];
  const fake = (async (_url: string, init: { body: URLSearchParams }) => {
    calls.push(init.body);
    return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
  }) as unknown as typeof fetch;
  return { fake, calls };
}

describe("Steam sign-in", () => {
  it("sends the visitor to Steam with this site as the return address", () => {
    const url = new URL(steamLoginUrl(SITE, "list"));
    expect(url.origin + url.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(url.searchParams.get("openid.return_to")).toBe(`${SITE}/api/auth/steam/return?next=list`);
    expect(url.searchParams.get("openid.realm")).toBe(SITE);
  });

  it("accepts a response Steam confirms, echoing it back as check_authentication", async () => {
    const { fake, calls } = steam(true);
    expect(await verifySteamLogin(response(), SITE, fake)).toBe(ID);
    expect(calls[0].get("openid.mode")).toBe("check_authentication");
    expect(calls[0].get("openid.sig")).toBe("c2ln");
    expect(calls[0].has("next")).toBe(false);
  });

  it("rejects what Steam doesn't confirm", async () => {
    expect(await verifySteamLogin(response(), SITE, steam(false).fake)).toBeNull();
  });

  it("rejects responses meant for another site or with a bad id, without asking Steam", async () => {
    const { fake, calls } = steam(true);
    expect(await verifySteamLogin(response({ "openid.return_to": "https://evil.example/api/auth/steam/return" }), SITE, fake)).toBeNull();
    expect(
      await verifySteamLogin(
        response({ "openid.claimed_id": "https://evil.example/openid/id/76561198006409530", "openid.identity": "https://evil.example/openid/id/76561198006409530" }),
        SITE,
        fake,
      ),
    ).toBeNull();
    expect(await verifySteamLogin(response({ "openid.mode": "cancel" }), SITE, fake)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
