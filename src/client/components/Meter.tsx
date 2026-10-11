import { POWER_BY_LEVEL, type PowerLevel } from "../../shared/power.ts";

/** Three bars, as many filled as the game is demanding. */
export function Meter({ level }: { level: PowerLevel }) {
  return (
    <span className={`meter meter-${level}`} aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/** The level as a badge; a guess is drawn with a dashed edge and says so. */
export function PowerBadge({ level, known }: { level: PowerLevel; known: boolean }) {
  const p = POWER_BY_LEVEL.get(level)!;
  return (
    <span
      className={`badge power ${known ? "" : "guess"}`}
      title={`${p.hint}. ${known ? "From the store's minimum requirements." : "Estimated from tags, age and price; requirements not read yet."}`}
    >
      <Meter level={level} />
      {p.label}
      {!known && <span className="visually-hidden"> (estimated)</span>}
    </span>
  );
}
