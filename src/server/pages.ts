import { readFileSync, statSync } from "node:fs";
import { CONTENT_FILTERS, FEATURE_BY_KEY, playerModes } from "../shared/features.ts";
import { POWER_BY_LEVEL } from "../shared/power.ts";
import { gamePath } from "../shared/slug.ts";
import type { GameDetailResponse, GameSummary, PricesResponse } from "../shared/types.ts";
import { db } from "./db/pool.ts";
import { LIVE } from "./db/schema.ts";

/*
 * The app is one page, but link previews and search engines don't run it. So the
 * shareable addresses (/u/..., /game/...) get the same index.html with their own
 * title, description and image written into the head, and a plain-text summary in
 * the body that the app replaces as soon as it starts.
 */

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute URL of this page. */
  url: string;
  image: string;
  imageWidth?: number;
  imageHeight?: number;
  /** Extra HTML for the body, read by crawlers before the app replaces it. */
  body?: string;
  jsonLd?: object;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Re-read when the file changes, so a new build never points at asset files that are gone.
let template: { at: number; html: string } | null = null;

/** index.html with this page's meta in place of the front page's. */
export function renderPage(indexPath: string, meta: PageMeta): string {
  const at = statSync(indexPath).mtimeMs;
  if (template?.at !== at) template = { at, html: readFileSync(indexPath, "utf8") };
  const e = escapeHtml;
  const setMeta = (html: string, attr: "name" | "property", key: string, value: string) => {
    const tag = `<meta ${attr}="${key}" content="${e(value)}" />`;
    const re = new RegExp(`<meta ${attr}="${key.replace(/[.:]/g, "\\$&")}" content="[^"]*"\\s*/?>`);
    return re.test(html) ? html.replace(re, () => tag) : html.replace("</head>", () => `    ${tag}\n  </head>`);
  };
  let html = template.html.replace(/<title>[^<]*<\/title>/, () => `<title>${e(meta.title)}</title>`);
  html = html.replace(/<link rel="canonical" href="[^"]*"\s*\/?>/, () => `<link rel="canonical" href="${e(meta.url)}" />`);
  html = setMeta(html, "name", "description", meta.description);
  html = setMeta(html, "property", "og:title", meta.title);
  html = setMeta(html, "property", "og:description", meta.description);
  html = setMeta(html, "property", "og:url", meta.url);
  html = setMeta(html, "property", "og:image", meta.image);
  html = setMeta(html, "property", "og:image:width", String(meta.imageWidth ?? 1200));
  html = setMeta(html, "property", "og:image:height", String(meta.imageHeight ?? 630));
  html = setMeta(html, "name", "twitter:card", "summary_large_image");
  if (meta.jsonLd) {
    // "<" is escaped so a game name can't close the script tag.
    const json = JSON.stringify(meta.jsonLd).replace(/</g, "\\u003c");
    html = html.replace("</head>", () => `    <script type="application/ld+json">${json}</script>\n  </head>`);
  }
  if (meta.body) html = html.replace('<div id="root"></div>', () => `<div id="root">${meta.body}</div>`);
  return html;
}

const money = (cents: number, currency: string) =>
  cents === 0 ? "Free" : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);
const DECK = ["", "Unsupported on Steam Deck", "Playable on Steam Deck", "Verified for Steam Deck"];
const STORE = { steam: "Steam", gog: "GOG" };

/** What the server knows about a game for its page; prices are the ones looked up recently, if any. */
export interface GamePageData {
  detail: GameDetailResponse;
  similar: GameSummary[];
  prices: PricesResponse | null;
  /** The currency of the store listings. */
  currency: string;
}

/** Head and body for a game's own page. */
export function gamePage({ detail, similar, prices, currency }: GamePageData, site: string): PageMeta {
  const { game, summary, specs, features } = detail;
  const e = escapeHtml;
  const name = e(game.name);
  const url = `${site}${gamePath(game.id, game.name)}`;
  const year = game.releaseDate ? new Date(game.releaseDate * 1000).getUTCFullYear() : null;
  const by = game.developers.length ? ` by ${game.developers.join(", ")}` : "";
  const reviews = summary.reviewCount >= 10 ? `${summary.reviewPct}% of ${count(summary.reviewCount)} reviews positive` : null;
  const power = POWER_BY_LEVEL.get(summary.power);
  const description = (
    game.description ||
    `${game.name}${year ? ` (${year})` : ""}${by}.${reviews ? ` ${reviews}.` : ""} Compare prices across Steam, GOG and key shops.`
  ).slice(0, 300);

  // Live official-store offers when someone asked for them lately, else the stores' own listings.
  const official = prices?.offers.filter((o) => o.kind === "official") ?? [];
  const offers = official.length
    ? official.map((o) => ({ shop: o.shop, price: o.price, base: o.basePrice, pct: o.discountPct, url: o.url, currency: prices!.currency }))
    : game.stores
        .filter((s) => s.price !== null)
        .map((s) => ({ shop: STORE[s.store], price: s.price!, base: s.basePrice ?? s.price!, pct: s.discountPct, url: s.url, currency }));
  offers.sort((a, b) => a.price - b.price);
  const cheapest = offers[0];

  const facts = [
    year ? `Released ${year}${by}` : game.comingSoon ? `Coming soon${by}` : null,
    reviews,
    game.tags.length ? `Tags: ${game.tags.slice(0, 10).join(", ")}` : null,
    game.peakPlayers ? `${count(game.peakPlayers)} players at yesterday's peak` : null,
    [game.platforms.windows && "Windows", game.platforms.mac && "macOS", game.platforms.linux && "Linux"].filter(Boolean).join(", ") || null,
    DECK[game.deck] || null,
  ].filter((f): f is string => !!f);

  const { modes } = playerModes(game.categories);
  const featureLabels = features.flatMap((k): string[] => {
    const label = FEATURE_BY_KEY.get(k)?.label;
    return label && !modes.includes(label) ? [label] : [];
  });

  const pc = [
    power ? `<p>${name} is ${power.label.toLowerCase()} to run: ${e(power.hint.toLowerCase())}.</p>` : "",
    specs
      ? "<ul>" +
        [
          specs.gpuText && `Minimum graphics: ${specs.gpuText}`,
          specs.recGpuText && `Recommended graphics: ${specs.recGpuText}`,
          specs.ram !== null && `Memory: ${specs.ram} GB`,
          specs.disk !== null && `Disk space: ${specs.disk} GB`,
        ]
          .filter((l): l is string => !!l)
          .map((l) => `<li>${e(l)}</li>`)
          .join("") +
        "</ul>"
      : "",
  ].join("");

  const body =
    `<main><h1>${name}</h1>` +
    `<p>${e(description)}</p>` +
    `<ul>${facts.map((f) => `<li>${e(f)}</li>`).join("")}</ul>` +
    (offers.length
      ? `<h2>Where to buy ${name} cheapest</h2><ul>` +
        offers
          .map(
            (o) =>
              `<li><a href="${e(o.url)}" rel="nofollow">${e(o.shop)}</a>: ${money(o.price, o.currency)}` +
              (o.pct > 0 ? ` (${o.pct}% off ${money(o.base, o.currency)})` : "") +
              "</li>",
          )
          .join("") +
        "</ul>" +
        (prices?.historicLow != null ? `<p>Historic low: ${money(prices.historicLow, prices.currency)}</p>` : "")
      : "") +
    (pc ? `<h2>Can my PC run ${name}?</h2>${pc}` : "") +
    (modes.length ? `<h2>Players</h2><p>${e(modes.join(", "))}</p>` : "") +
    (featureLabels.length ? `<h2>Features</h2><p>${e(featureLabels.join(", "))}</p>` : "") +
    (similar.length
      ? `<h2>Games like ${name}</h2><ul>` +
        similar.map((s) => `<li><a href="${e(gamePath(s.id, s.name))}">${e(s.name)}</a></li>`).join("") +
        "</ul>"
      : "") +
    `<p><a href="/">Search Steam and GOG games</a></p></main>`;

  const os = [game.platforms.windows && "Windows", game.platforms.mac && "macOS", game.platforms.linux && "Linux"].filter(Boolean);
  return {
    title: `${game.name}: price, reviews and where to buy cheapest · Game Search`,
    description,
    url,
    image: game.image ?? `${site}/og.png`,
    imageWidth: game.image ? 460 : 1200,
    imageHeight: game.image ? 215 : 630,
    body,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "VideoGame",
      name: game.name,
      url,
      description: description.slice(0, 500),
      ...(game.image ? { image: game.image } : {}),
      ...(game.releaseDate ? { datePublished: new Date(game.releaseDate * 1000).toISOString().slice(0, 10) } : {}),
      ...(game.developers.length ? { author: game.developers.map((name) => ({ "@type": "Organization", name })) } : {}),
      ...(game.tags.length ? { genre: game.tags.slice(0, 5) } : {}),
      gamePlatform: "PC",
      applicationCategory: "GameApplication",
      ...(os.length ? { operatingSystem: os.join(", ") } : {}),
      ...(summary.reviewCount >= 10
        ? { aggregateRating: { "@type": "AggregateRating", ratingValue: summary.reviewPct, bestRating: 100, worstRating: 0, ratingCount: summary.reviewCount } }
        : {}),
      ...(cheapest
        ? {
            offers: {
              "@type": "AggregateOffer",
              lowPrice: (cheapest.price / 100).toFixed(2),
              highPrice: (offers[offers.length - 1].price / 100).toFixed(2),
              priceCurrency: cheapest.currency,
              offerCount: offers.length,
            },
          }
        : {}),
    },
  };
}

// ---- sitemaps: games with a few reviews, adult-only ones left out ----

const PER_FILE = 50_000;
const PORN_BIT = 1 << CONTENT_FILTERS.findIndex((f) => f.key === "porn");
const LISTED = `review_count >= 5 AND (content & ${PORN_BIT}) = 0`;

export async function sitemapIndex(site: string): Promise<string> {
  const { rows } = await db().query<{ n: string }>(`SELECT count(*) AS n FROM ${LIVE}.games WHERE ${LISTED}`);
  const files = Math.max(1, Math.ceil(Number(rows[0].n) / PER_FILE));
  const entries = Array.from({ length: files }, (_, i) => `<sitemap><loc>${site}/sitemaps/games-${i + 1}.xml</loc></sitemap>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<sitemap><loc>${site}/sitemaps/pages.xml</loc></sitemap>\n${entries.join("\n")}\n</sitemapindex>\n`;
}

export function sitemapPages(site: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n<url><loc>${site}/</loc></url>\n<url><loc>${site}/?view=library</loc></url>\n</urlset>\n`;
}

/** One file of game URLs, most-reviewed first; null past the last file. */
export async function sitemapGames(site: string, n: number): Promise<string | null> {
  if (!Number.isInteger(n) || n < 1) return null;
  const { rows } = await db().query<{ id: string; name: string }>(
    `SELECT g.id, d.name FROM ${LIVE}.games g JOIN ${LIVE}.game_details d USING (id)
      WHERE ${LISTED.replace(/review_count|content/g, (c) => `g.${c}`)}
      ORDER BY g.review_count DESC, g.id LIMIT ${PER_FILE} OFFSET ${(n - 1) * PER_FILE}`,
  );
  if (!rows.length) return null;
  const urls = rows.map((r) => `<url><loc>${escapeHtml(site + gamePath(r.id, r.name))}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}
