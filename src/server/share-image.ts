import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { CompareResponse, LibraryResponse } from "../shared/types.ts";
import { formatMoney, formatNumber, persona, profileHandle, wrappedSlides, type Slide } from "../shared/wrapped.ts";
import { USER_AGENT } from "./http.ts";

/*
 * Share images, drawn on the server so link previews (Discord, WhatsApp, X) show
 * them and people can save them: satori lays out a tree of styled boxes into SVG,
 * resvg turns that into a PNG. The look follows the site: dotted paper, biro-blue
 * outlines, hard shadows, pixel headings.
 */

const C = {
  paper: "#f5ecd7",
  card: "#fffaee",
  ink: "#1d2452",
  inkSoft: "#586092",
  dots: "#1d245230",
  yellow: "#ffe45c",
  grape: "#7c5ce6",
  accents: ["#ffe45c", "#e0d6fa", "#cdeedb", "#ffd5e2", "#cfe6f7"],
};

export type Format = "card" | "story";
const SIZE: Record<Format, { width: number; height: number }> = {
  card: { width: 1200, height: 630 },
  story: { width: 1080, height: 1920 },
};

// ---- a tiny element builder (satori takes React-shaped objects) ----

type Style = Record<string, string | number>;
type Child = Node | string | null | false | undefined;
interface Node {
  type: string;
  props: { style?: Style; src?: string; width?: number; height?: number; children?: Child[] | Child };
}
const box = (style: Style, ...children: Child[]): Node => ({
  type: "div",
  props: { style: { display: "flex", boxSizing: "border-box", ...style }, children: children.filter((c) => c !== null && c !== false && c !== undefined) },
});
const text = (style: Style, value: string): Node => ({ type: "div", props: { style: { display: "flex", ...style }, children: value } });
const img = (src: string, width: number, height: number, style: Style = {}): Node => ({
  type: "img",
  props: { src, width, height, style: { width, height, objectFit: "cover", ...style } },
});

// ---- fonts and remote images ----

let fonts: { name: string; data: Buffer; weight: 400 | 500 | 700 | 800; style: "normal" }[] | null = null;
function loadFonts() {
  if (fonts) return fonts;
  // Served from public/ in development and dist/ once built.
  const dir = [resolve("dist/fonts"), resolve("public/fonts")].find((d) => existsSync(d));
  if (!dir) throw new Error("Fonts for share images are missing (public/fonts)");
  fonts = readdirSync(dir)
    .filter((f) => f.endsWith(".woff"))
    .map((f) => ({
      name: f.startsWith("jersey") ? "Jersey" : "Figtree",
      data: readFileSync(join(dir, f)),
      weight: (Number(f.match(/-(\d{3})-/)?.[1]) || 400) as 400 | 500 | 700 | 800,
      style: "normal" as const,
    }));
  return fonts;
}

const images = new Map<string, Promise<string | null>>();
/** A remote picture as a data URL (null if it can't be had), cached for the process. */
function picture(url: string | null | undefined): Promise<string | null> {
  if (!url) return Promise.resolve(null);
  let hit = images.get(url);
  if (!hit) {
    hit = fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(8000) })
      .then(async (res) => {
        const type = res.headers.get("content-type") ?? "";
        if (!res.ok || !/^image\/(jpeg|png)/.test(type)) return null;
        return `data:${type.split(";")[0]};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
      })
      .catch(() => null);
    images.set(url, hit);
    if (images.size > 300) images.delete(images.keys().next().value!);
  }
  return hit;
}

export const steamHeader = (appId: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
/** Steam's 184px avatar; the profile only gives us the 64px one. */
const bigAvatar = (url: string | null) => url?.replace(/_medium\.jpg$/, "_full.jpg") ?? null;

// ---- rendering, one at a time so a burst of previews can't stack up memory ----

let queue: Promise<unknown> = Promise.resolve();
async function render(node: Node, format: Format): Promise<Buffer> {
  const run = async () => {
    const { width, height } = SIZE[format];
    const svg = await satori(node as never, { width, height, fonts: loadFonts() });
    return new Resvg(svg, { fitTo: { mode: "width", value: width } }).render().asPng();
  };
  const result = queue.then(run, run);
  queue = result.catch(() => {});
  return result;
}

// ---- shared pieces ----

/** The closing line: a call to action and where to go. */
interface Footer {
  cta: string;
  url: string;
}

/** A page of the image. `footer` null draws it plain: no logo, no link (the in-app Wrapped viewer). */
function page(format: Format, site: string, footer: Footer | null, ...children: Child[]): Node {
  const story = format === "story";
  const domain = site.replace(/^https?:\/\//, "");
  return box(
    {
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: C.paper,
      backgroundImage: `radial-gradient(circle at center, ${C.dots} 0px, ${C.dots} 2px, transparent 3px)`,
      backgroundSize: story ? "36px 36px" : "30px 30px",
      padding: story ? "90px 80px" : "44px 56px",
      fontFamily: "Figtree",
      color: C.ink,
    },
    // The logo only: the address is in the footer, once.
    footer && text({ fontFamily: "Jersey", fontSize: story ? 64 : 40, lineHeight: 1 }, "game search"),
    ...children,
    !footer
      ? null
      : story
      ? // A story ends on a band across the bottom, so it reads as finished and says where to go.
        box(
          { marginTop: "auto", flexDirection: "column", gap: 10, backgroundColor: C.ink, padding: "34px 44px", boxShadow: `10px 10px 0 ${C.grape}` },
          text({ fontFamily: "Jersey", fontSize: 72, lineHeight: 1, color: C.yellow }, footer.cta),
          text({ fontSize: 34, fontWeight: 700, color: C.card }, `${domain}${footer.url}`),
        )
      : text({ marginTop: "auto", fontSize: 26, fontWeight: 700, color: C.ink }, `${footer.cta} ${domain}${footer.url}`),
  );
}

/** An outlined box with the site's hard shadow. */
function panel(style: Style, ...children: Child[]): Node {
  return box({ border: `5px solid ${C.ink}`, boxShadow: `10px 10px 0 ${C.ink}`, backgroundColor: C.card, ...style }, ...children);
}

const sticker = (value: string, size: number, background = C.yellow) =>
  text(
    { fontFamily: "Jersey", fontSize: size, lineHeight: 1, padding: `${size * 0.12}px ${size * 0.22}px`, backgroundColor: background, border: `4px solid ${C.ink}` },
    value,
  );

const hours = (m: number) => `${formatNumber(Math.round(m / 60))} h`;

/** A font size at which `value` fits on `lines` lines of `width` px (Jersey is about half an em wide). */
const fit = (value: string, width: number, max: number, lines = 2) => {
  const longest = Math.max(4, ...value.split(/\s+/).map((w) => w.length));
  // Fits in `lines` lines overall, and the longest word fits on one.
  return Math.max(48, Math.min(max, Math.floor((width * lines) / (Math.max(4, value.length) * 0.52)), Math.floor(width / (longest * 0.6))));
};

// ---- the cards ----

export async function profileImage(lib: LibraryResponse, format: Format, site: string): Promise<Buffer> {
  const story = format === "story";
  const avatar = await picture(bigAvatar(lib.profile.avatar));
  const top = lib.insights.topGames[0];
  const header = top ? await picture(steamHeader(top.appId)) : null;
  const topThree = story
    ? await Promise.all(lib.insights.topGames.slice(0, 3).map(async (game) => ({ game, image: await picture(steamHeader(game.appId)) })))
    : [];
  const p = persona(lib);
  const t = lib.totals;
  const stats: [string, string][] = [
    [formatNumber(t.games), "games"],
    [hours(t.playtimeMinutes), "played"],
    [formatMoney(t.valueNow, lib.currency), "worth today"],
    [formatNumber(t.neverPlayed), "never played"],
  ];
  const statSize = story ? 84 : 58;
  const statGrid = box(
    { flexWrap: "wrap", gap: story ? 28 : 18, width: story ? "100%" : 560 },
    ...stats.map(([v, label], i) =>
      panel(
        { flexDirection: "column", width: story ? 446 : 268, padding: story ? "24px 28px" : "14px 20px", backgroundColor: C.accents[i + 1] },
        text({ fontFamily: "Jersey", fontSize: fit(v, story ? 380 : 220, statSize, 1), lineHeight: 1 }, v),
        text({ fontSize: story ? 30 : 22, fontWeight: 700, color: C.inkSoft }, label),
      ),
    ),
  );
  const who = box(
    { flexDirection: "column", gap: story ? 26 : 14, flex: story ? undefined : 1 } as Style,
    box(
      { alignItems: "center", gap: story ? 32 : 22 },
      avatar ? img(avatar, story ? 180 : 110, story ? 180 : 110, { border: `5px solid ${C.ink}` }) : null,
      text({ fontSize: (lib.profile.name ?? "").length > 18 ? (story ? 54 : 34) : story ? 72 : 44, fontWeight: 800, lineHeight: 1.1, maxWidth: story ? 680 : 360 }, lib.profile.name ?? "A Steam library"),
    ),
    box({}, sticker(p.title, story ? 92 : 56)),
    text({ fontSize: story ? 40 : 25, fontWeight: 500, lineHeight: 1.3, maxWidth: story ? 900 : 480 }, p.line),
  );
  const handle = profileHandle(lib);
  const body = story
    ? box(
        { flexDirection: "column", gap: 46, marginTop: 64, marginBottom: 50 },
        who,
        statGrid,
        topThree.length
          ? box(
              { flexDirection: "column", gap: 18 },
              text({ fontSize: 32, fontWeight: 800, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 2 }, "Most played"),
              ...topThree.map(({ game, image }, i) =>
                box(
                  { alignItems: "center", gap: 26 },
                  image ? img(image, 214, 100, { border: `4px solid ${C.ink}` }) : box({ width: 214, height: 100, backgroundColor: C.accents[i + 1], border: `4px solid ${C.ink}` }),
                  box(
                    { flexDirection: "column", flex: 1 },
                    text({ fontSize: game.name.length > 28 ? 32 : 38, fontWeight: 800, lineHeight: 1.15 }, `${i + 1}. ${game.name}`),
                    text({ fontSize: 30, fontWeight: 500, color: C.inkSoft }, hours(game.minutes)),
                  ),
                ),
              ),
            )
          : null,
      )
    : box(
        { flexDirection: "column", marginTop: 30, gap: 26 },
        box({ gap: 36, alignItems: "flex-start" }, who, statGrid),
        top && header
          ? box(
              { alignItems: "center", gap: 18 },
              img(header, 150, 70, { border: `4px solid ${C.ink}` }),
              text({ fontSize: 24, fontWeight: 700 }, `Most played: ${top.name}, ${hours(top.minutes)}`),
            )
          : null,
      );
  return render(page(format, site, { cta: "What's yours worth?", url: `/u/${handle}` }, body), format);
}

export async function slideImage(lib: LibraryResponse, slide: Slide, index: number, site: string, plain = false): Promise<Buffer> {
  const header = slide.appId ? await picture(steamHeader(slide.appId)) : null;
  const avatar = slide.key === "intro" ? await picture(bigAvatar(lib.profile.avatar)) : null;
  const accent = C.accents[index % C.accents.length];
  const body = box(
    { flexDirection: "column", gap: 34, flex: 1, justifyContent: "center", padding: "40px 0 50px" },
    avatar ? img(avatar, 200, 200, { border: `5px solid ${C.ink}` }) : null,
    text({ fontSize: 44, fontWeight: 800, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 2 }, slide.eyebrow),
    panel(
      { flexDirection: "column", padding: "36px 44px", backgroundColor: accent, alignSelf: "flex-start", maxWidth: 920 },
      text({ fontFamily: "Jersey", fontSize: fit(slide.big, 830, 210, 2), lineHeight: 1 }, slide.big),
    ),
    text({ fontSize: 50, fontWeight: 800, lineHeight: 1.2 }, slide.title),
    header ? panel({ alignSelf: "flex-start" }, img(header, 760, 355)) : null,
    ...slide.lines.map((l) => text({ fontSize: 38, fontWeight: 500, lineHeight: 1.25 }, l)),
  );
  const footer = plain ? null : { cta: "See the whole story", url: `/u/${profileHandle(lib)}/wrapped` };
  return render(page("story", site, footer, body), "story");
}

export async function compareImage(cmp: CompareResponse, site: string): Promise<Buffer> {
  const [avA, avB] = await Promise.all([picture(bigAvatar(cmp.a.profile.avatar)), picture(bigAvatar(cmp.b.profile.avatar))]);
  const person = (name: string | null, avatar: string | null, title: string, align: "flex-start" | "flex-end") =>
    box(
      { flexDirection: "column", alignItems: align, gap: 12, width: 400 },
      avatar ? img(avatar, 120, 120, { border: `5px solid ${C.ink}` }) : null,
      text({ fontSize: 40, fontWeight: 800, lineHeight: 1.1, maxWidth: 400 }, name ?? "Someone"),
      sticker(title, 40),
    );
  const stat = (value: string, label: string, i: number) =>
    panel(
      { flexDirection: "column", padding: "12px 20px", backgroundColor: C.accents[i], flex: 1 },
      text({ fontFamily: "Jersey", fontSize: 56, lineHeight: 1 }, value),
      text({ fontSize: 22, fontWeight: 700, color: C.inkSoft }, label),
    );
  const coop = cmp.together.filter((g) => g.onlineCoop).length;
  const body = box(
    { flexDirection: "column", gap: 30, marginTop: 26 },
    box(
      { justifyContent: "space-between", alignItems: "center" },
      person(cmp.a.profile.name, avA, cmp.a.persona.title, "flex-start"),
      text({ fontFamily: "Jersey", fontSize: 110, color: C.grape }, "vs"),
      person(cmp.b.profile.name, avB, cmp.b.persona.title, "flex-end"),
    ),
    box(
      { gap: 22 },
      stat(formatNumber(cmp.common), "games in common", 0),
      stat(`${Math.round(cmp.tasteMatch * 100)}%`, "taste match", 1),
      stat(formatNumber(coop), "co-op games both own", 2),
    ),
  );
  return render(page("card", site, { cta: "Compare with your friends at", url: "" }, body), "card");
}

export { wrappedSlides };
