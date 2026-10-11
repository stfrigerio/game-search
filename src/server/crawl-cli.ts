import { Catalog } from "./catalog.ts";
import { catalogConfig } from "./config.ts";

// `npm run crawl`: rebuild the catalogue snapshot without starting the web server.
const catalog = new Catalog(catalogConfig);
await catalog.load();
const ticker = setInterval(() => {
  const { progress } = catalog.status();
  if (progress) console.log(progress);
}, 5000);
await catalog.refresh();
clearInterval(ticker);

const status = catalog.status();
console.log(JSON.stringify({ games: status.gameCount, stores: status.storeCounts }, null, 2));
if (status.lastError) process.exit(1);
