import { describe, expect, it } from "vitest";
import { resolveSteamId } from "../src/server/steam-profile.ts";

describe("resolveSteamId", () => {
  it("accepts a SteamID64 or a /profiles/ URL without any network call", async () => {
    expect(await resolveSteamId("76561198006409530")).toBe("76561198006409530");
    expect(await resolveSteamId("https://steamcommunity.com/profiles/76561198006409530/")).toBe("76561198006409530");
  });

  it("rejects input that can't be a custom URL name", async () => {
    expect(await resolveSteamId("../../etc/passwd")).toBeNull();
    expect(await resolveSteamId("https://steamcommunity.com/profiles/123")).toBeNull();
    expect(await resolveSteamId("a")).toBeNull();
  });
});
