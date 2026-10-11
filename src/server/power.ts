import type { PowerLevel, Specs } from "../shared/power.ts";
import type { Game } from "../shared/types.ts";

/**
 * Reads a store's minimum requirements and turns them into a power level. Requirements
 * are free text written by each publisher, so this picks out the three things that are
 * nearly always there (memory, the graphics card, disk space) and ignores the rest.
 */

const text = (html: string) =>
  html
    .replace(/<br\s*\/?>|<\/li>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/[®™©]/g, "");

/** The first line starting with one of the labels, without the label. */
function field(lines: string[], labels: RegExp): string | null {
  for (const line of lines) {
    const m = labels.exec(line);
    if (m) return line.slice(m.index + m[0].length).trim();
  }
  return null;
}

/** Every "8 GB" / "512MB" in a string, in GB. */
function sizes(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/(\d+(?:[.,]\d+)?)\s*(gb|gigabytes?|g\b|mb|megabytes?)/gi)) {
    const n = Number(m[1].replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push(/^g/i.test(m[2]) ? n : n / 1024);
  }
  return out;
}

/** xx50, xx60, xx70...: how a card sits inside its generation, xx60 being 1. */
const tier = (n: number) => {
  const t = n % 100;
  if (t === 0) return 1; // "GTX 600 series": no card named, take the usual one
  return t >= 90 ? 2.2 : t >= 80 ? 1.7 : t >= 70 ? 1.35 : t >= 60 ? 1 : t >= 50 ? 0.7 : t >= 40 ? 0.4 : t >= 30 ? 0.3 : 0.2;
};

/**
 * Rough speed of every graphics card named in a line, on a scale where a GTX 1060 is 6,
 * a GTX 660 is 2 and integrated graphics are under 1. Only good for sorting cards into
 * three buckets, which is all it is used for.
 */
export function gpuScores(line: string): number[] {
  const scores: number[] = [];
  let s = ` ${line} `;
  const take = (re: RegExp, score: (m: RegExpMatchArray) => number | null) => {
    s = s.replace(re, (...args) => {
      const v = score(args as unknown as RegExpMatchArray);
      if (v !== null) scores.push(v);
      return " ";
    });
  };
  take(/\barc\s*a?(\d{3})\b/gi, (m) => (Number(m[1]) >= 700 ? 10 : Number(m[1]) >= 500 ? 8 : 4.5));
  // Integrated graphics before Radeon, so "Intel HD 4000" is not read as a Radeon HD.
  take(/\bintel\b[^,\/\n(]*|\buhd\s*(?:graphics)?\s*\d*|\biris\b[^,\/\n(]*|\bhd\s+graphics\s*\d*/gi, () => 0.7);
  take(/\b(?:integrated|onboard|on-board)\b/gi, () => 0.5);
  // A "Ti", "SUPER" or "XT" after the number is the same card pushed a little further.
  const boosted = (suffix: string | undefined) => (suffix ? 1.15 : 1);
  take(/\brtx\s*-?(\d{4})(?!\d)\s*(ti|super)?/gi, (m) => {
    const n = Number(m[1]);
    const base = n >= 5000 ? 15 : n >= 4000 ? 13 : n >= 3000 ? 11 : 8;
    return base * tier(n) * boosted(m[2]);
  });
  take(/\b(?:gtx?|gts|geforce)\s*-?(\d{3,4})(?!\d)\s*(ti|super)?/gi, (m) => {
    const n = Number(m[1]);
    if (n >= 6000) return n >= 8000 ? 0.5 : 0.25; // GeForce 6600 ... 9800
    if (n >= 1600) return 6.5 * tier(n) * boosted(m[2]);
    if (n >= 1000) return 6 * tier(n) * boosted(m[2]);
    const series = Math.floor(n / 100);
    const base = series >= 9 ? 4.5 : series >= 7 ? 3 : series >= 6 ? 2 : series >= 5 ? 1.4 : series >= 4 ? 1 : 0.5;
    return base * tier(n) * boosted(m[2]);
  });
  take(/\brx\s*-?(\d{3,4})(?!\d)\s*(xt)?/gi, (m) => {
    const n = Number(m[1]);
    if (n < 1000) {
      const t = n % 100;
      return (n >= 500 ? 6.5 : 6) * (t >= 90 ? 1.1 : t >= 80 ? 1 : t >= 70 ? 0.85 : t >= 60 ? 0.45 : 0.3);
    }
    const h = Math.floor((n % 1000) / 100);
    const base = n >= 9000 ? 18 : n >= 7000 ? 15 : n >= 6000 ? 13 : 10;
    return base * (h >= 9 ? 1.6 : h >= 8 ? 1.3 : h >= 7 ? 1 : h >= 6 ? 0.75 : 0.55) * boosted(m[2]);
  });
  take(/\br9\s*-?(?:fury|nano|(\d{3})(?!\d))/gi, (m) => (!m[1] ? 6 : Number(m[1]) % 100 >= 90 ? 5.2 : Number(m[1]) % 100 >= 80 ? 3.7 : 2.6));
  take(/\br7\s*-?\d{3}(?!\d)/gi, () => 2);
  take(/\br5\s*-?\d{3}(?!\d)/gi, () => 0.8);
  take(/\b(?:radeon\s+)?hd\s*-?(\d{4})(?!\d)/gi, (m) => {
    const n = Number(m[1]);
    const h = Math.floor((n % 1000) / 100);
    const base = n >= 7000 ? 1.6 : n >= 6000 ? 1.1 : n >= 5000 ? 0.9 : 0.5;
    if (n % 1000 === 0) return base; // "HD 7000 series"
    return base * (h >= 9 ? 1.9 : h >= 8 ? 1.3 : h >= 7 ? 0.8 : h >= 6 ? 0.5 : 0.3);
  });
  take(/\b(?:x1\d{3}|radeon\s+x\d{3,4}|geforce\s*fx|tnt2|voodoo)\b/gi, () => 0.1);
  return scores;
}

export function parseRequirements(minimumHtml: string): Specs | null {
  const lines = text(minimumHtml)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const memory = field(lines, /^(?:memory|ram|system memory)\s*:/i);
  const graphics = field(lines, /^(?:graphics|video card|video|gpu|graphics card)\s*:/i) ?? "";
  const storage = field(lines, /^(?:storage|hard drive|hard disk(?: space)?|disk space|hdd)\s*:/i);
  const ram = memory ? Math.max(0, ...sizes(memory)) || null : null;
  // Memory sizes in the graphics line are video memory; the smallest is the real floor.
  const vramSizes = sizes(graphics).filter((v) => v >= 0.03 && v <= 32);
  const scores = gpuScores(graphics);
  const disk = storage ? Math.max(0, ...sizes(storage)) || null : null;
  if (ram === null && !graphics && disk === null) return null;
  // Publishers list a few cards they consider equal; the middle one is the safest reading.
  scores.sort((a, b) => a - b);
  const middle = scores.length ? (scores[Math.floor((scores.length - 1) / 2)] + scores[Math.ceil((scores.length - 1) / 2)]) / 2 : null;
  const round = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
  return {
    ram: round(ram),
    vram: vramSizes.length ? round(Math.min(...vramSizes)) : null,
    disk: round(disk),
    gpu: round(middle),
    gpuText: graphics.replace(/\s+/g, " ").slice(0, 90),
  };
}

/** Level from the graphics card alone, if the requirements named one or gave its memory. */
function graphicsLevel(s: Specs): PowerLevel | null {
  if (s.gpu !== null) return s.gpu < 1.5 ? 1 : s.gpu < 5.5 ? 2 : 3;
  // Video memory alone is a looser hint than a named card, so it takes more to call it demanding.
  if (s.vram !== null) return s.vram <= 1 ? 1 : s.vram < 6 ? 2 : 3;
  return null;
}

/**
 * The level the minimum requirements point to, or null when they say too little.
 * The graphics card decides and memory only nudges; disk space says nothing about power. Memory alone is a poor
 * guide (plenty of small 2D games ask for 8 GB), so without a card it only settles
 * the clear cases.
 */
export function levelFromSpecs(s: Specs): PowerLevel | null {
  let level = graphicsLevel(s);
  if (level === null) {
    if (s.ram === null) return null;
    if (s.ram <= 2) return 1;
    if (s.ram >= 16) return 3;
    return null;
  }
  if (s.ram !== null && s.ram >= 16 && level < 3) level++;
  // "Any card with 1 GB" next to 8 GB of memory is a modern game being vague, not a light one.
  if (s.ram !== null && s.ram >= 8 && level === 1 && s.gpu === null) level = 2;
  return level as PowerLevel;
}

/* ---------- The estimate, for games whose requirements we have not read yet ---------- */

const LIGHT_TAGS: Record<string, number> = {
  "2d": 3, "pixel graphics": 3, "visual novel": 4, "text-based": 4, "point & click": 2.5, "card game": 2.5, "hand-drawn": 2,
  "2d platformer": 3, minimalist: 2, "hidden object": 3, "interactive fiction": 3, "board game": 2.5, "word game": 3,
  idler: 2.5, incremental: 2, "top-down": 1.5, "side scroller": 2, "bullet hell": 1.5, deckbuilding: 2, "card battler": 2,
  retro: 1.5, "1990's": 1.5, "1980s": 2, "old school": 1.5, "dating sim": 2, "2d fighter": 2, metroidvania: 1.5, puzzle: 1,
  casual: 0.7, tabletop: 2, "choose your own adventure": 2.5, "shoot 'em up": 1.5, "grid-based movement": 1.5, "match 3": 3,
  solitaire: 3, clicker: 3, rpgmaker: 4, "turn-based strategy": 0.7, "precision platformer": 1.5, "puzzle platformer": 1,
};
const HEAVY_TAGS: Record<string, number> = {
  "open world": 3, realistic: 2.5, "3d": 1, "first-person": 1.2, "third person": 1.5, fps: 1.5, "third-person shooter": 2,
  vr: 2, "open world survival craft": 2, "souls-like": 1.5, "action rpg": 0.8, "immersive sim": 0.5, "battle royale": 2,
  "looter shooter": 2, "automobile sim": 2, racing: 1, flight: 1, cinematic: 1.2, "massively multiplayer": 1, mmorpg: 1.5,
  hunting: 1.5, "space sim": 1, military: 0.7, "action-adventure": 0.6, "hack and slash": 0.5, "survival horror": 0.7,
  "walking simulator": 0.7, driving: 0.8, "3d fighter": 1, "3d platformer": 0.5, sandbox: 0.3, destruction: 1,
};

/**
 * A guess from what we already know: tags, age and price. Flat, small and old games
 * are light; recent 3D games sold at full price are demanding; the rest is medium.
 */
export function estimateLevel(game: Game, now = Date.now()): PowerLevel {
  let light = 0;
  let heavy = 0;
  game.tags.forEach((tag, rank) => {
    const key = tag.toLowerCase();
    const weight = rank < 6 ? 1 : 0.6;
    light += (LIGHT_TAGS[key] ?? 0) * weight;
    heavy += (HEAVY_TAGS[key] ?? 0) * weight;
  });
  const year = game.releaseDate ? new Date(game.releaseDate * 1000).getUTCFullYear() : new Date(now).getUTCFullYear();
  const age = new Date(now).getUTCFullYear() - year;
  // What strained a PC ten years ago is light work now.
  heavy *= age <= 4 ? 1 : age <= 7 ? 0.7 : age <= 11 ? 0.4 : 0.12;
  const basePrice = Math.max(0, ...game.stores.map((s) => s.basePrice ?? 0)) / 100;
  if (basePrice >= 40 && age <= 8) heavy += 2.5;
  else if (basePrice >= 25 && age <= 8) heavy += 1;
  else if (basePrice > 0 && basePrice < 8) light += 1;
  if (game.categories.includes(54)) heavy += 3; // VR only

  const score = heavy - light;
  if (score >= 5) return 3;
  if (score <= 0.5) return 1;
  return 2;
}
