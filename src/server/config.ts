import { resolve } from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 3001),
  dataFile: resolve(env.DATA_FILE ?? "data/catalog.json.gz"),
  /** Region for store prices. GOG needs the matching currency spelled out. */
  country: env.STORE_COUNTRY ?? "US",
  currency: env.STORE_CURRENCY ?? "USD",
  /** Hours between full re-crawls (Steam ~200 requests, GOG ~85). */
  refreshHours: Number(env.REFRESH_HOURS ?? 24),
  /** Cap the crawl for quick local experiments, e.g. CRAWL_LIMIT=5000. */
  crawlLimit: env.CRAWL_LIMIT ? Number(env.CRAWL_LIMIT) : undefined,
  skipSteamSpy: env.SKIP_STEAMSPY === "1",
};

export const catalogConfig = {
  file: config.dataFile,
  country: config.country,
  currency: config.currency,
  maxAgeMs: config.refreshHours * 3600_000,
  limit: config.crawlLimit,
  skipSteamSpy: config.skipSteamSpy,
};
