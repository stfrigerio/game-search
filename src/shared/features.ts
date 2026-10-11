/**
 * Filterable game features, built from Steam's store categories (GOG features are
 * mapped onto the same ids). Each feature matches if the game has ANY of its
 * category ids. The order here is the bit position in the search index's masks,
 * so keep it at 32 entries or fewer.
 */
export const FEATURES = [
  // Players
  { key: "single", label: "Single-player", group: "players", categories: [2] },
  { key: "multi", label: "Multiplayer", group: "players", categories: [1, 49, 36, 47, 37, 9, 38, 48, 39, 24, 20, 27] },
  { key: "coop", label: "Co-op", group: "players", categories: [9, 38, 48, 39] },
  { key: "onlineCoop", label: "Online co-op", group: "players", categories: [38] },
  { key: "localCoop", label: "Local / split-screen co-op", group: "players", categories: [39] },
  { key: "lanCoop", label: "LAN co-op", group: "players", categories: [48] },
  { key: "splitScreen", label: "Split screen (any)", group: "players", categories: [24, 37, 39] },
  { key: "pvp", label: "PvP", group: "players", categories: [49, 36, 47, 37] },
  { key: "onlinePvp", label: "Online PvP", group: "players", categories: [36] },
  { key: "mmo", label: "MMO", group: "players", categories: [20] },
  { key: "crossplay", label: "Cross-platform multiplayer", group: "players", categories: [27] },
  { key: "remotePlay", label: "Remote Play Together", group: "players", categories: [44] },
  // Steam features
  { key: "achievements", label: "Achievements", group: "features", categories: [22] },
  { key: "cloud", label: "Cloud saves", group: "features", categories: [23] },
  { key: "workshop", label: "Steam Workshop (mods)", group: "features", categories: [30, 51] },
  { key: "cards", label: "Trading cards", group: "features", categories: [29] },
  { key: "levelEditor", label: "Level editor", group: "features", categories: [17] },
  { key: "familySharing", label: "Family Sharing", group: "features", categories: [62] },
  { key: "hdr", label: "HDR", group: "features", categories: [61] },
  { key: "iap", label: "In-app purchases", group: "features", categories: [35] },
  // Controls & hardware
  { key: "controllerFull", label: "Full controller support", group: "controls", categories: [28] },
  { key: "controller", label: "Any controller support", group: "controls", categories: [28, 18] },
  { key: "gamepadPreferred", label: "Gamepad recommended", group: "controls", categories: [60] },
  { key: "vr", label: "VR supported", group: "controls", categories: [31, 53, 54] },
  { key: "vrOnly", label: "VR only", group: "controls", categories: [54] },
  // Accessibility
  { key: "difficulty", label: "Adjustable difficulty", group: "accessibility", categories: [78] },
  { key: "saveAnytime", label: "Save anytime", group: "accessibility", categories: [79] },
  { key: "subtitles", label: "Subtitle options", group: "accessibility", categories: [65, 13] },
  { key: "colorblind", label: "Color alternatives", group: "accessibility", categories: [66] },
  { key: "noTimedInput", label: "Playable without timed input", group: "accessibility", categories: [74] },
  { key: "keyboardOnly", label: "Keyboard-only option", group: "accessibility", categories: [75] },
  { key: "textSize", label: "Adjustable text size", group: "accessibility", categories: [64] },
] as const;

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureGroup = (typeof FEATURES)[number]["group"];

export const FEATURE_GROUPS: Record<FeatureGroup, string> = {
  players: "Players",
  features: "Features",
  controls: "Controls & VR",
  accessibility: "Accessibility",
};

export const FEATURE_BY_KEY = new Map<string, (typeof FEATURES)[number]>(FEATURES.map((f) => [f.key, f]));

/** GOG feature slugs mapped to the Steam category ids above. */
export const GOG_FEATURE_CATEGORIES: Record<string, number[]> = {
  single: [2],
  multi: [1],
  coop: [9],
  achievements: [22],
  cloud_saves: [23],
  controller_support: [28],
  leaderboards: [25],
  overlay: [],
};

/** Steam's ELanguage ids. `code` is what goes in URLs. */
export const LANGUAGES = [
  { id: 0, code: "en", name: "English" },
  { id: 1, code: "de", name: "German" },
  { id: 2, code: "fr", name: "French" },
  { id: 3, code: "it", name: "Italian" },
  { id: 4, code: "ko", name: "Korean" },
  { id: 5, code: "es", name: "Spanish (Spain)" },
  { id: 6, code: "zh-cn", name: "Chinese (Simplified)" },
  { id: 7, code: "zh-tw", name: "Chinese (Traditional)" },
  { id: 8, code: "ru", name: "Russian" },
  { id: 9, code: "th", name: "Thai" },
  { id: 10, code: "ja", name: "Japanese" },
  { id: 11, code: "pt", name: "Portuguese (Portugal)" },
  { id: 12, code: "pl", name: "Polish" },
  { id: 13, code: "da", name: "Danish" },
  { id: 14, code: "nl", name: "Dutch" },
  { id: 15, code: "fi", name: "Finnish" },
  { id: 16, code: "no", name: "Norwegian" },
  { id: 17, code: "sv", name: "Swedish" },
  { id: 18, code: "hu", name: "Hungarian" },
  { id: 19, code: "cs", name: "Czech" },
  { id: 20, code: "ro", name: "Romanian" },
  { id: 21, code: "tr", name: "Turkish" },
  { id: 22, code: "pt-br", name: "Portuguese (Brazil)" },
  { id: 23, code: "bg", name: "Bulgarian" },
  { id: 24, code: "el", name: "Greek" },
  { id: 25, code: "ar", name: "Arabic" },
  { id: 26, code: "uk", name: "Ukrainian" },
  { id: 27, code: "es-419", name: "Spanish (Latin America)" },
  { id: 28, code: "vi", name: "Vietnamese" },
  { id: 29, code: "id", name: "Indonesian" },
] as const;

export const LANGUAGE_BY_CODE = new Map<string, (typeof LANGUAGES)[number]>(LANGUAGES.map((l) => [l.code, l]));

/**
 * Steam content descriptors, grouped into what people actually want to hide. The order
 * is the bit position in the catalogue's content mask, so add new entries at the end.
 *
 * "porn" is narrower than "sexual": games Steam marks as adult-only sexual content
 * (descriptor 3), plus games whose `topTags` rank among their first PORN_TAG_RANK tags.
 * A Hentai tag far down the list is players joking (Marvel Rivals has one), so only a
 * prominent one counts. A game with a sex scene (The Witcher 3) is "sexual", not "porn".
 */
export const CONTENT_FILTERS = [
  { key: "sexual", label: "Sexual content / nudity", descriptors: [1, 3, 4], topTags: [] },
  { key: "gore", label: "Frequent violence or gore", descriptors: [2], topTags: [] },
  { key: "mature", label: "General mature content", descriptors: [5], topTags: [] },
  { key: "porn", label: "Porn (adult-only games)", descriptors: [3], topTags: ["hentai", "nsfw"] },
] as const;
export const PORN_TAG_RANK = 5;

export type ContentKey = (typeof CONTENT_FILTERS)[number]["key"];

/** Steam's player-mode categories, in the order (and with the names) the store page uses. */
const STEAM_PLAYER_MODES: [number, string][] = [
  [2, "Single-player"],
  [1, "Multi-player"],
  [20, "MMO"],
  [49, "PvP"],
  [36, "Online PvP"],
  [47, "LAN PvP"],
  [37, "Shared/Split Screen PvP"],
  [9, "Co-op"],
  [38, "Online Co-op"],
  [48, "LAN Co-op"],
  [39, "Shared/Split Screen Co-op"],
  [24, "Shared/Split Screen"],
  [27, "Cross-Platform Multiplayer"],
  [44, "Remote Play Together"],
];

// Steam's data also carries generic categories ("Multi-player", "Co-op", "PvP")
// next to the specific ones; its store page hides a generic one when a specific
// one is there, and so do we.
const HIDDEN_WHEN: Record<number, number[]> = {
  1: [20, 36, 47, 37, 38, 48, 39, 24, 27],
  9: [38, 48, 39],
  49: [36, 47, 37],
};
const ONLINE = [20, 36, 38];
const LOCAL = [39, 24, 37, 48, 47];

/**
 * Player modes for a game page, as Steam's store page lists them, plus a note when
 * a game has multiplayer but none of it online (e.g. couch co-op only).
 */
export function playerModes(categories: number[]): { modes: string[]; localOnly: boolean } {
  const has = new Set(categories);
  const modes = STEAM_PLAYER_MODES.filter(([id]) => has.has(id) && !(HIDDEN_WHEN[id] ?? []).some((s) => has.has(s))).map(
    ([, name]) => name,
  );
  const localOnly = LOCAL.some((id) => has.has(id)) && !ONLINE.some((id) => has.has(id));
  return { modes, localOnly };
}
