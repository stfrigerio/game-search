import type { LibraryGame, LibraryResponse } from "./types.ts";

/*
 * What a library says about its owner, in a few lines: the gaming personality and
 * the "Wrapped" story slides. Pure, so the server draws the same slides as images
 * that the page describes in text (alt text, screen readers).
 */

export interface Persona {
  key: string;
  title: string;
  line: string;
}

export interface Slide {
  key: string;
  /** Small line above the headline. */
  eyebrow: string;
  /** The one big thing: a number or a name. */
  big: string;
  /** What the big thing means. */
  title: string;
  lines: string[];
  /** Steam app id whose header image goes on the slide. */
  appId?: number;
}

const money = (cents: number, currency: string) =>
  cents === 0 ? "Free" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents >= 100_000 ? 0 : 2 }).format(cents / 100);
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);
const hoursOf = (minutes: number) => Math.round(minutes / 60);
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

/** Tag families and the personality each one makes, checked in this order. */
const TAG_PERSONAS: { tags: string[]; key: string; title: string; line: string }[] = [
  { tags: ["souls-like", "difficult", "precision platformer"], key: "masochist", title: "The Masochist", line: "Dies a lot. Enjoys it." },
  { tags: ["roguelike", "roguelite", "action roguelike", "roguelike deckbuilder"], key: "runner", title: "The Run Repeater", line: "Just one more run. Then another." },
  { tags: ["strategy", "grand strategy", "rts", "4x", "turn-based strategy", "wargame"], key: "strategist", title: "The Strategist", line: "Plays the long game, literally." },
  { tags: ["city builder", "colony sim", "automation", "management", "base building", "simulation"], key: "builder", title: "The Builder", line: "Would rather plan the factory than fight the war." },
  { tags: ["survival", "crafting", "open world survival craft"], key: "survivor", title: "The Survivor", line: "Punches trees for a living." },
  { tags: ["rpg", "jrpg", "crpg", "action rpg", "party-based rpg"], key: "adventurer", title: "The Adventurer", line: "Reads every quest log. Talks to every NPC." },
  { tags: ["fps", "shooter", "tactical", "hero shooter", "battle royale"], key: "sharpshooter", title: "The Sharpshooter", line: "Aim first, ask questions never." },
  { tags: ["horror", "psychological horror", "survival horror"], key: "brave", title: "The Brave", line: "Plays with the lights off, on purpose." },
  { tags: ["puzzle", "logic"], key: "puzzler", title: "The Puzzler", line: "Sees a locked door, gets excited." },
  { tags: ["story rich", "visual novel", "narrative", "choices matter"], key: "storyteller", title: "The Story Lover", line: "Here for the plot, staying for the ending." },
  { tags: ["sports", "racing", "football (soccer)"], key: "athlete", title: "The Athlete", line: "Competitive, even on the couch." },
];

export function persona(lib: LibraryResponse): Persona {
  const { totals, insights } = lib;
  const played = totals.playtimeMinutes;
  const top = insights.topGames[0];
  if (totals.games >= 40 && totals.neverPlayed / totals.games >= 0.5) {
    return { key: "collector", title: "The Collector", line: `Owns ${count(totals.games)} games and has never started ${count(totals.neverPlayed)} of them.` };
  }
  if (top && insights.concentration.top1 >= 0.5) {
    return { key: "devotee", title: "The Devotee", line: `More than half of every hour played went into ${top.name}.` };
  }
  if (played && insights.multiplayerMinutes / played >= 0.7) {
    return { key: "squad", title: "The Squad Player", line: "Most of the hours are spent playing with other people." };
  }
  const tags = insights.byTag.slice(0, 3).map((t) => t.tag.toLowerCase());
  for (const p of TAG_PERSONAS) if (tags.some((t) => p.tags.includes(t))) return { key: p.key, title: p.title, line: p.line };
  if (played && insights.concentration.top1 < 0.15) {
    return { key: "explorer", title: "The Explorer", line: "Never sticks to one game for long. Tries everything." };
  }
  return { key: "allrounder", title: "The All-Rounder", line: "A bit of everything, and good at most of it." };
}

/** Today's price per hour played, for games played at least five hours. */
export function bestValue(games: LibraryGame[]): LibraryGame | null {
  let best: LibraryGame | null = null;
  let bestRate = Infinity;
  for (const g of games) {
    if (!g.priceNow || g.playtimeMinutes < 300) continue;
    const rate = g.priceNow / (g.playtimeMinutes / 60);
    if (rate < bestRate) [best, bestRate] = [g, rate];
  }
  return best;
}

/** The story, a slide at a time. Slides with nothing to say are left out. */
export function wrappedSlides(lib: LibraryResponse): Slide[] {
  const { totals, insights, currency } = lib;
  const name = lib.profile.name ?? "This library";
  const slides: Slide[] = [];
  const hours = hoursOf(totals.playtimeMinutes);
  const days = Math.floor(totals.playtimeMinutes / 1440);

  slides.push({
    key: "intro",
    eyebrow: `${name} on Steam`,
    big: `${count(hours)} h`,
    title: days >= 2 ? `That's ${count(days)} days of your life, spent playing.` : "Hours played, all time.",
    lines: [`${plural(totals.games, "game")} owned`, `${plural(totals.games - totals.neverPlayed, "game")} actually played`],
  });

  const top = insights.topGames[0];
  if (top && top.minutes >= 60) {
    const pct = Math.round(insights.concentration.top1 * 100);
    slides.push({
      key: "top",
      eyebrow: "Number one",
      big: top.name,
      title: `${count(hoursOf(top.minutes))} hours. ${pct}% of everything you played.`,
      lines: insights.topGames.slice(1, 4).map((g, i) => `${i + 2}. ${g.name}, ${count(hoursOf(g.minutes))} h`),
      appId: top.appId,
    });
  }

  if (insights.byTag.length >= 2) {
    const [first, ...rest] = insights.byTag;
    slides.push({
      key: "taste",
      eyebrow: "What you play",
      big: first.tag,
      title: `${count(hoursOf(first.minutes))} hours in ${plural(first.games, "game")} tagged ${first.tag}.`,
      lines: rest.slice(0, 3).map((t) => `${t.tag}, ${count(hoursOf(t.minutes))} h`),
    });
  }

  const value = bestValue(lib.games);
  if (value) {
    const rate = Math.round(value.priceNow! / (value.playtimeMinutes / 60));
    slides.push({
      key: "value",
      eyebrow: "Best money ever spent",
      big: `${money(rate, currency)}/h`,
      title: `${value.name}: ${money(value.priceNow!, currency)} today, played for ${count(hoursOf(value.playtimeMinutes))} hours.`,
      lines: ["Cheaper per hour than any film, book or coffee."],
      appId: value.appId,
    });
  }

  if (totals.neverPlayed > 0) {
    const gem = insights.unplayedGems[0];
    slides.push({
      key: "shame",
      eyebrow: "The pile of shame",
      big: count(totals.neverPlayed),
      title: `games never started${totals.neverPlayedValue ? `, worth ${money(totals.neverPlayedValue, currency)} today` : ""}.`,
      lines: gem ? [`Start with ${gem.name}: ${gem.reviewPct}% of players loved it.`] : [],
      appId: gem?.appId,
    });
  }

  const p = persona(lib);
  const topTags = insights.byTag.slice(0, 3).map((t) => t.tag);
  slides.push({
    key: "persona",
    eyebrow: "Your gaming personality",
    big: p.title,
    title: p.line,
    lines: topTags.length ? [`Most of your hours: ${topTags.join(", ")}.`] : [],
  });

  slides.push({
    key: "worth",
    eyebrow: "Your library is worth",
    big: money(totals.valueNow, currency),
    title: totals.valueFull > totals.valueNow ? `at today's prices (${money(totals.valueFull, currency)} without the sales).` : "at today's prices.",
    lines: ["What's yours worth?"],
  });
  return slides;
}

/** The handle used in short links: the custom URL name when there is one, else the SteamID64. */
export function profileHandle(lib: Pick<LibraryResponse, "steamId" | "profile">): string {
  return lib.profile.profileUrl?.match(/steamcommunity\.com\/id\/([^/?#]+)/)?.[1] ?? lib.steamId;
}

/** Text for the share card and link previews. */
export function profileBlurb(lib: LibraryResponse): { title: string; description: string } {
  const name = lib.profile.name ?? "A Steam library";
  const p = persona(lib);
  return {
    title: `${name}: ${p.title} · ${count(lib.totals.games)} games, ${count(hoursOf(lib.totals.playtimeMinutes))} hours`,
    description: `${p.line} Library worth ${money(lib.totals.valueNow, lib.currency)} today, ${count(lib.totals.neverPlayed)} games never played. What's yours worth?`,
  };
}

export const formatMoney = money;
export const formatNumber = count;
