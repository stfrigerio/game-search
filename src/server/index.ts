import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { parseQuery } from "../shared/query.ts";
import type { GameDetailResponse, MetaResponse } from "../shared/types.ts";
import { Catalog } from "./catalog.ts";
import { catalogConfig, config } from "./config.ts";
import { getPrices } from "./prices.ts";

const catalog = new Catalog(catalogConfig);
const app = express();

app.get("/api/meta", (_req, res) => {
  const body: MetaResponse = { ...catalog.status(), tags: catalog.index?.allTags ?? [] };
  res.json(body);
});

app.get("/api/search", (req, res) => {
  if (!catalog.index) {
    res.status(503).json({ error: "The catalogue is still being built", status: catalog.status() });
    return;
  }
  const params = new URLSearchParams(req.url.split("?")[1] ?? "");
  res.json(catalog.index.search(parseQuery(params)));
});

app.get("/api/games/:id", (req, res) => {
  const hit = catalog.index?.get(req.params.id);
  if (!hit) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(hit satisfies GameDetailResponse);
});

app.get("/api/games/:id/prices", async (req, res) => {
  const hit = catalog.index?.get(req.params.id);
  if (!hit) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(await getPrices(hit.game));
});

// In production the server also hosts the built front-end.
const dist = resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));

const loaded = await catalog.load();
console.log(loaded ? `Loaded ${catalog.status().gameCount} games from disk` : "No catalogue on disk yet, crawling…");
const refreshIfStale = () => {
  if (catalog.isStale()) void catalog.refresh();
};
refreshIfStale();
setInterval(refreshIfStale, 60 * 60 * 1000).unref();
