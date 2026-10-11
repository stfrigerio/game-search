import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { parseQuery } from "../shared/query.ts";
import type { BestOffer, GameDetailResponse, MetaResponse } from "../shared/types.ts";
import { Catalog } from "./catalog.ts";
import { catalogConfig, config } from "./config.ts";
import { PAGE_SIZE } from "./search.ts";
import { getPrices, getPricesBatch } from "./prices.ts";
import { fetchWishlist, resolveSteamId } from "./steam-profile.ts";

const catalog = new Catalog(catalogConfig);
const app = express();
app.use(express.json({ limit: "256kb" }));

const pageSizeOf = (v: unknown) => Math.min(60, Math.max(1, Number(v) || PAGE_SIZE));

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
  res.json(catalog.index.search(parseQuery(params), pageSizeOf(params.get("pageSize"))));
});

// Same as GET, but restricted to a list of game ids (the user's saved list), which
// can be too long for a URL.
app.post("/api/search", (req, res) => {
  if (!catalog.index) {
    res.status(503).json({ error: "The catalogue is still being built", status: catalog.status() });
    return;
  }
  const params = new URLSearchParams(typeof req.body?.params === "string" ? req.body.params : "");
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string").slice(0, 5000) : undefined;
  res.json(catalog.index.search(parseQuery(params), pageSizeOf(params.get("pageSize")), ids));
});

app.get("/api/steam/wishlist", async (req, res) => {
  const profile = String(req.query.profile ?? "");
  try {
    const steamId = await resolveSteamId(profile);
    if (!steamId) {
      res.status(404).json({ error: "Couldn't find that Steam profile. Paste your profile URL or SteamID64." });
      return;
    }
    const appIds = await fetchWishlist(steamId);
    if (!appIds.length) {
      res.status(404).json({
        error: "That wishlist is empty or private. In Steam, set Privacy → Game details to Public.",
      });
      return;
    }
    const ids = appIds.map((a) => `steam:${a}`);
    const known = catalog.index?.summariesFor(ids).map((s) => s.id) ?? [];
    res.json({ steamId, ids: known, total: appIds.length });
  } catch (err) {
    res.status(502).json({ error: `Steam didn't respond: ${String(err)}` });
  }
});

app.get("/api/games/:id", (req, res) => {
  const hit = catalog.index?.get(req.params.id);
  if (!hit) {
    res.status(404).json({ error: "Game not found" });
    return;
  }
  res.json(hit satisfies GameDetailResponse);
});

app.get("/api/games/:id/similar", (req, res) => {
  res.json(catalog.index?.similar(req.params.id) ?? []);
});

// Cheapest official-store offer for each of up to 60 games (one page of results).
app.post("/api/prices/best", async (req, res) => {
  const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((x: unknown) => typeof x === "string").slice(0, 60) : [];
  const games = ids.flatMap((id) => {
    const hit = catalog.index?.get(id);
    return hit ? [hit.game] : [];
  });
  const prices = await getPricesBatch(games);
  const body: Record<string, BestOffer | null> = {};
  for (const [id, p] of prices) {
    const best = p.offers[0];
    body[id] = best ? { shop: best.shop, price: best.price, basePrice: best.basePrice, discountPct: best.discountPct, url: best.url, historicLow: p.historicLow } : null;
  }
  res.json(body);
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
