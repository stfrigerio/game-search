import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { parseQuery } from "../shared/query.ts";
import type { BestOffer } from "../shared/types.ts";
import { config } from "./config.ts";
import { closeDb } from "./db/pool.ts";
import { existingIds, getGameDetail, getGames, getMeta, PAGE_SIZE, searchGames, similarGames } from "./db/search.ts";
import { getPrices, getPricesBatch } from "./prices.ts";
import { fetchWishlist, resolveSteamId } from "./steam-profile.ts";

// The catalogue lives in Postgres (DATABASE_URL) and is rebuilt by `npm run crawl`
// (game-search-crawl.timer); this process only answers queries.

const app = express();
app.use(express.json({ limit: "256kb" }));

const pageSizeOf = (v: unknown) => Math.min(60, Math.max(1, Number(v) || PAGE_SIZE));
const stringIds = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];

/** Express 5 forwards rejected promises to the error handler; this keeps handlers short. */
const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

app.get(
  "/api/meta",
  route(async (_req, res) => {
    res.json(await getMeta());
  }),
);

app.get(
  "/api/search",
  route(async (req, res) => {
    const params = new URLSearchParams(req.url.split("?")[1] ?? "");
    res.json(await searchGames(parseQuery(params), pageSizeOf(params.get("pageSize"))));
  }),
);

// Same as GET, but restricted to a list of game ids (the user's saved list), which
// can be too long for a URL.
app.post(
  "/api/search",
  route(async (req, res) => {
    const params = new URLSearchParams(typeof req.body?.params === "string" ? req.body.params : "");
    const ids = Array.isArray(req.body?.ids) ? stringIds(req.body.ids, 5000) : undefined;
    res.json(await searchGames(parseQuery(params), pageSizeOf(params.get("pageSize")), ids));
  }),
);

app.get(
  "/api/steam/wishlist",
  route(async (req, res) => {
    const profile = String(req.query.profile ?? "");
    let appIds: number[];
    let steamId: string | null;
    try {
      steamId = await resolveSteamId(profile);
      if (!steamId) {
        res.status(404).json({ error: "Couldn't find that Steam profile. Paste your profile URL or SteamID64." });
        return;
      }
      appIds = await fetchWishlist(steamId);
    } catch (err) {
      res.status(502).json({ error: `Steam didn't respond: ${String(err)}` });
      return;
    }
    if (!appIds.length) {
      res.status(404).json({ error: "That wishlist is empty or private. In Steam, set Privacy → Game details to Public." });
      return;
    }
    const ids = await existingIds(appIds.map((a) => `steam:${a}`));
    res.json({ steamId, ids, total: appIds.length });
  }),
);

app.get(
  "/api/games/:id",
  route(async (req, res) => {
    const detail = await getGameDetail(String(req.params.id));
    if (!detail) res.status(404).json({ error: "Game not found" });
    else res.json(detail);
  }),
);

app.get(
  "/api/games/:id/similar",
  route(async (req, res) => {
    res.json(await similarGames(String(req.params.id)));
  }),
);

// Cheapest official-store offer for each of up to 60 games (one page of results).
app.post(
  "/api/prices/best",
  route(async (req, res) => {
    const games = await getGames(stringIds(req.body?.ids, 60));
    const prices = await getPricesBatch(games);
    const body: Record<string, BestOffer | null> = {};
    for (const [id, p] of prices) {
      const best = p.offers[0];
      body[id] = best
        ? { shop: best.shop, price: best.price, basePrice: best.basePrice, discountPct: best.discountPct, url: best.url, historicLow: p.historicLow }
        : null;
    }
    res.json(body);
  }),
);

app.get(
  "/api/games/:id/prices",
  route(async (req, res) => {
    const [game] = await getGames([String(req.params.id)]);
    if (!game) res.status(404).json({ error: "Game not found" });
    else res.json(await getPrices(game));
  }),
);

// In production the server also hosts the built front-end.
const dist = resolve("dist");
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  // Before the first crawl the catalogue tables don't exist or are empty.
  const missing = (err as { code?: string }).code === "42P01";
  res.status(missing ? 503 : 500).json({
    error: missing ? "No catalogue yet. Run `npm run migrate` and `npm run crawl`." : "Something went wrong",
  });
});

const server = app.listen(config.port, () => console.log(`API listening on http://localhost:${config.port}`));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void closeDb().finally(() => process.exit(0)));
  });
}
