const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3001),
  /** Interface to listen on; unset means all of them. Set 127.0.0.1 behind a reverse proxy. */
  host: env.HOST,
  /** Pause between system-requirement requests to Steam (about 200 are allowed every five minutes). 0 turns the reading off. */
  specsPauseMs: Number(env.SPECS_PAUSE_MS ?? 1600),
};

export const crawlerConfig = {
  /** Region for store prices. GOG needs the matching currency spelled out. */
  country: env.STORE_COUNTRY ?? "US",
  currency: env.STORE_CURRENCY ?? "USD",
  /** Cap games per store for quick local experiments, e.g. CRAWL_LIMIT=5000. */
  limit: env.CRAWL_LIMIT ? Number(env.CRAWL_LIMIT) : undefined,
  /** Skip the slow (~5 min) SteamSpy player-count crawl. */
  skipSteamSpy: env.SKIP_STEAMSPY === "1",
};
