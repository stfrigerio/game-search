/** "steam:620" + "Portal 2" → "/game/steam-620-portal-2". The name part is only for people and search engines. */
export function gamePath(id: string, name: string): string {
  const words = name
    .replace(/[™®©]/g, "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80)
    .replace(/-$/, "");
  return `/game/${id.replace(":", "-")}${words ? `-${words}` : ""}`;
}

/** The game id at the start of a /game/ slug, or null. */
export function gameIdFromSlug(slug: string): string | null {
  const m = slug.match(/^(steam|gog)-(\d+)(?:-|$)/);
  return m ? `${m[1]}:${m[2]}` : null;
}
