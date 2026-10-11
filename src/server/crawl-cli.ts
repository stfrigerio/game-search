import { crawlerConfig } from "./config.ts";
import { crawlCatalog, refreshPlayerCounts } from "./crawler.ts";
import { closeDb } from "./db/pool.ts";

// `npm run crawl`: rebuild the catalogue (run nightly by game-search-crawl.timer).
// `npm run crawl -- --players`: only refresh player counts from SteamSpy.
try {
  if (process.argv.includes("--players")) await refreshPlayerCounts();
  else await crawlCatalog(crawlerConfig);
} catch (err) {
  console.error("Crawl failed:", err);
  process.exitCode = 1;
} finally {
  await closeDb();
  console.log(`Peak memory: ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
}
