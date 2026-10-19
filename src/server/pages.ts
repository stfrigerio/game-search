import { readFileSync, statSync } from "node:fs";
import { CONTENT_FILTERS } from "../shared/features.ts";
import { gamePath } from "../shared/slug.ts";
import type { Game } from "../shared/types.ts";
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

/** Head and body for a game's own page. */
export function gamePage(game: Game, site: string): PageMeta {
  const url = `${site}${gamePath(game.id, game.name)}`;
  const reviews = [...game.stores].sort((a, b) => b.reviewCount - a.reviewCount)[0];
  const year = game.releaseDate ? new Date(game.releaseDate * 1000).getUTCFullYear() : null;
  const description =
    game.description ||
    `${game.name}${year ? ` (${year})` : ""}${game.developers.length ? ` by ${game.developers.join(", ")}` : ""}. Compare prices across Steam, GOG and key shops.`;
  return {
    title: `${game.name}: price, reviews and where to buy cheapest · Game Search`,
    description: description.slice(0, 300),
    url,
    image: game.image ?? `${site}/og.png`,
    imageWidth: game.image ? 460 : 1200,
    imageHeight: game.image ? 215 : 630,
    body:
      `<main><h1>${escapeHtml(game.name)}</h1>` +
      `<p>${escapeHtml(description)}</p>` +
      (game.tags.length ? `<p>${escapeHtml(game.tags.slice(0, 10).join(", "))}</p>` : "") +
      `<p><a href="/">Search ${escapeHtml("Steam and GOG")} games</a></p></main>`,
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
      ...(reviews && reviews.reviewCount >= 10
        ? { aggregateRating: { "@type": "AggregateRating", ratingValue: reviews.reviewPct, bestRating: 100, worstRating: 0, ratingCount: reviews.reviewCount } }
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
