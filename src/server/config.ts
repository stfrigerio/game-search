const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3001),
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
