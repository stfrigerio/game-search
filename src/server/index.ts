import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { parseQuery } from "../shared/query.ts";
import type { BestOffer } from "../shared/types.ts";
import { config } from "./config.ts";
import { closeDb } from "./db/pool.ts";
import { existingIds, getGameDetail, getGames, getMeta, PAGE_SIZE, searchGames, similarGames } from "./db/search.ts";
import { buildCompare } from "./compare.ts";
import { getLibrary, LibraryError } from "./library.ts";
import { gamePage, renderPage, sitemapGames, sitemapIndex, sitemapPages, type PageMeta } from "./pages.ts";
import { compareImage, profileImage, slideImage, type Format } from "./share-image.ts";
import { getMedia } from "./media.ts";
import { DESTINATIONS, isDestination, steamLoginUrl, verifySteamLogin } from "./steam-openid.ts";
import { getPrices, getPricesBatch } from "./prices.ts";
import { readSpecsForever } from "./specs.ts";
import { fetchFriends, fetchWishlist, resolveSteamId } from "./steam-profile.ts";
import { gameIdFromSlug } from "../shared/slug.ts";
import type { LibraryResponse } from "../shared/types.ts";
import { profileBlurb, profileHandle, wrappedSlides } from "../shared/wrapped.ts";

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

// "Sign in with Steam" (OpenID): one click instead of pasting a profile link. Nothing
// is stored; the verified SteamID64 goes into the URL of the page that asked.
const siteOf = (req: Request) => config.siteUrl || `${req.protocol}://${req.get("host")}`;

app.get("/api/auth/steam", (req, res) => {
  const next = isDestination(req.query.next) ? req.query.next : "library";
  res.redirect(302, steamLoginUrl(siteOf(req), next));
});

app.get(
  "/api/auth/steam/return",
  route(async (req, res) => {
    const next = isDestination(req.query.next) ? req.query.next : "library";
    let id: string | null = null;
    try {
      id = await verifySteamLogin(req.query as Record<string, unknown>, siteOf(req));
    } catch (err) {
      console.warn("Steam sign-in check failed:", String(err));
    }
    res.redirect(302, id ? DESTINATIONS[next](id) : `/?view=${next}&signin=failed`);
  }),
);

// Custom URL names → SteamID64, remembered for an hour (short links resolve them on every view).
const handles = new Map<string, { at: number; id: Promise<string | null> }>();
function steamIdOf(handle: string): Promise<string | null> {
  const key = handle.trim().toLowerCase();
  const hit = handles.get(key);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.id;
  const id = resolveSteamId(handle);
  id.catch(() => handles.delete(key));
  handles.set(key, { at: Date.now(), id });
  if (handles.size > 2000) handles.delete(handles.keys().next().value!);
  return id;
}

/** A library from whatever identifies a profile; errors carry the HTTP status to answer with. */
async function libraryOf(profile: string): Promise<LibraryResponse> {
  if (!config.steamApiKey) throw new LibraryError("Library lookups aren't set up on this server (no STEAM_API_KEY).", 501);
  let steamId: string | null;
  try {
    steamId = await steamIdOf(profile);
  } catch (err) {
    throw new LibraryError(`Steam didn't respond: ${String(err)}`, 502);
  }
  if (!steamId) throw new LibraryError("Couldn't find that Steam profile. Paste your profile URL or SteamID64.", 404);
  try {
    return await getLibrary(steamId, config.steamApiKey);
  } catch (err) {
    if (err instanceof LibraryError) throw err;
    throw new LibraryError(`Steam didn't respond: ${String(err).split(config.steamApiKey).join("…")}`, 502);
  }
}

const libraryRoute = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  route(async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof LibraryError) res.status(err.status).json({ error: err.message });
      else throw err;
    }
  });

// A profile's game library, priced: value today, at full price, playtime.
app.get(
  "/api/steam/library",
  libraryRoute(async (req, res) => {
    res.json(await libraryOf(String(req.query.profile ?? "")));
  }),
);

// Friends to compare with (empty when the friend list is private).
app.get(
  "/api/steam/friends",
  libraryRoute(async (req, res) => {
    const steamId = config.steamApiKey ? await steamIdOf(String(req.query.profile ?? "")) : null;
    if (!steamId) {
      res.status(404).json({ error: "Couldn't find that Steam profile." });
      return;
    }
    res.json(await fetchFriends(steamId, config.steamApiKey));
  }),
);

// Two libraries side by side.
app.get(
  "/api/steam/compare",
  libraryRoute(async (req, res) => {
    const [a, b] = await Promise.all([libraryOf(String(req.query.a ?? "")), libraryOf(String(req.query.b ?? ""))]);
    res.json(buildCompare(a, b));
  }),
);

// ---- share images: drawn once, kept ten minutes (as long as the library itself) ----

const pngs = new Map<string, { at: number; png: Promise<Buffer> }>();
function cachedPng(key: string, draw: () => Promise<Buffer>): Promise<Buffer> {
  const hit = pngs.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.png;
  const png = draw();
  png.catch(() => pngs.delete(key));
  pngs.set(key, { at: Date.now(), png });
  if (pngs.size > 60) pngs.delete(pngs.keys().next().value!);
  return png;
}

/** Answer with the image, or with the site's own card when the profile can't be drawn (private, missing). */
async function sendPng(res: Response, key: string, draw: () => Promise<Buffer>) {
  try {
    const png = await cachedPng(key, draw);
    res.set("Cache-Control", "public, max-age=600").type("png").send(png);
  } catch (err) {
    if (!(err instanceof LibraryError)) console.warn("Share image failed:", String(err));
    res.set("Cache-Control", "no-store").redirect(302, "/og.png");
  }
}

// /api/share/u/<handle>/card.png, /story.png and /wrapped-<slide>.png
app.get(
  "/api/share/u/:handle/:file",
  route(async (req, res) => {
    const handle = String(req.params.handle);
    const file = String(req.params.file);
    const site = siteOf(req);
    const format = ({ "card.png": "card", "story.png": "story" } as Record<string, Format>)[file];
    const slide = file.match(/^wrapped-([a-z]+)\.png$/)?.[1];
    if (!format && !slide) {
      res.status(404).type("text/plain").send("Not found");
      return;
    }
    await sendPng(res, `${handle.toLowerCase()}/${file}`, async () => {
      const lib = await libraryOf(handle);
      if (format) return profileImage(lib, format, site);
      const slides = wrappedSlides(lib);
      const i = slides.findIndex((s) => s.key === slide);
      if (i < 0) throw new LibraryError("No such slide", 404);
      return slideImage(lib, slides[i], i, site);
    });
  }),
);

app.get(
  "/api/share/vs/:a/:b/card.png",
  route(async (req, res) => {
    const [ha, hb] = [String(req.params.a), String(req.params.b)];
    await sendPng(res, `vs/${ha.toLowerCase()}/${hb.toLowerCase()}`, async () => {
      const [a, b] = await Promise.all([libraryOf(ha), libraryOf(hb)]);
      return compareImage(buildCompare(a, b), siteOf(req));
    });
  }),
);

app.get(
  "/api/steam/wishlist",
  route(async (req, res) => {
    const profile = String(req.query.profile ?? "");
    let appIds: number[];
    let steamId: string | null;
    try {
      steamId = await steamIdOf(profile);
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

// Screenshot and trailer URLs; the browser loads the files from Steam's / GOG's CDN.
app.get(
  "/api/games/:id/media",
  route(async (req, res) => {
    const [game] = await getGames([String(req.params.id)]);
    if (!game) res.status(404).json({ error: "Game not found" });
    else res.set("Cache-Control", "public, max-age=3600").json(await getMedia(game));
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

// ---- sitemaps for search engines ----

const xml = (res: Response, body: string) => res.set("Cache-Control", "public, max-age=86400").type("application/xml").send(body);
app.get(
  "/sitemap.xml",
  route(async (req, res) => xml(res, await sitemapIndex(siteOf(req)))),
);
app.get("/sitemaps/pages.xml", (req, res) => void xml(res, sitemapPages(siteOf(req))));
app.get(
  "/sitemaps/:file",
  route(async (req, res) => {
    const n = Number(String(req.params.file).match(/^games-(\d+)\.xml$/)?.[1]);
    const body = n ? await sitemapGames(siteOf(req), n) : null;
    if (body) xml(res, body);
    else res.status(404).type("text/plain").send("Not found");
  }),
);

// In production the server also hosts the built front-end.
const dist = resolve("dist");
if (existsSync(dist)) {
  const index = resolve(dist, "index.html");
  const page = (res: Response, meta: PageMeta) => res.set("Cache-Control", "no-cache").type("html").send(renderPage(index, meta));

  // Waits briefly for the library so the preview can name the person; the image doesn't need to wait.
  const profileMeta = async (handle: string) => {
    const lib = await Promise.race([libraryOf(handle).catch(() => null), new Promise<null>((r) => setTimeout(r, 2500, null))]);
    return lib ? { ...profileBlurb(lib), handle: profileHandle(lib), name: lib.profile.name } : null;
  };

  // Short links to a profile: /u/<custom URL name or SteamID64>, and its Wrapped.
  app.get(
    ["/u/:handle", "/u/:handle/wrapped", "/u/:handle/vs"],
    route(async (req, res) => {
      const handle = String(req.params.handle);
      const wrapped = req.path.endsWith("/wrapped");
      const picking = req.path.endsWith("/vs");
      const site = siteOf(req);
      const m = await profileMeta(handle);
      const path = `/u/${encodeURIComponent(handle)}${wrapped ? "/wrapped" : picking ? "/vs" : ""}`;
      page(res, {
        title: m ? (wrapped ? `${m.name ?? "A Steam library"}: the year in games, wrapped` : m.title) : "A Steam library, valued and charted · Game Search",
        description: m?.description ?? "What a Steam library is worth today, where the hours went, and the games never played. What's yours worth?",
        url: `${site}${path}`,
        image: `${site}/api/share/u/${encodeURIComponent(handle)}/card.png`,
      });
    }),
  );

  app.get(
    "/u/:a/vs/:b",
    route(async (req, res) => {
      const [a, b] = [String(req.params.a), String(req.params.b)];
      const site = siteOf(req);
      const [ma, mb] = await Promise.all([profileMeta(a), profileMeta(b)]);
      const names = `${ma?.name ?? a} vs ${mb?.name ?? b}`;
      page(res, {
        title: `${names}: whose Steam library wins? · Game Search`,
        description: "Games in common, what to play together online, and how alike two Steam libraries are. Compare yours with a friend.",
        url: `${site}/u/${encodeURIComponent(a)}/vs/${encodeURIComponent(b)}`,
        image: `${site}/api/share/vs/${encodeURIComponent(a)}/${encodeURIComponent(b)}/card.png`,
      });
    }),
  );

  // A game's own address, for search engines and link previews.
  app.get(
    "/game/:slug",
    route(async (req, res) => {
      const id = gameIdFromSlug(String(req.params.slug));
      const [game] = id ? await getGames([id]) : [];
      if (!game) {
        res.status(404).type("text/plain").send("Not found");
        return;
      }
      page(res, gamePage(game, siteOf(req)));
    }),
  );

  app.use(express.static(dist));
  // Everything else lives at "/" (its state is in the query string), so any other path is not a page.
  app.use((_req, res) => void res.status(404).type("text/plain").send("Not found"));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  // Before the first crawl the catalogue tables don't exist or are empty.
  const missing = (err as { code?: string }).code === "42P01";
  res.status(missing ? 503 : 500).json({
    error: missing ? "No catalogue yet. Run `npm run migrate` and `npm run crawl`." : "Something went wrong",
  });
});

const server = createServer(app).listen({ port: config.port, host: config.host }, () =>
  console.log(`API listening on http://${config.host ?? "localhost"}:${config.port}`),
);

// Power levels come from Steam's system requirements, read a game at a time in the background.
if (config.specsPauseMs > 0) void readSpecsForever(config.specsPauseMs);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => void closeDb().finally(() => process.exit(0)));
  });
}
