import { Pixel, STAR } from "../pixel.tsx";
import { useSavedList } from "../savedList.ts";

export function SaveButton({ id, large = false }: { id: string; large?: boolean }) {
  const list = useSavedList();
  const saved = list.has(id);
  return (
    <button
      className={`save ${saved ? "saved" : ""} ${large ? "save-large" : ""}`}
      aria-label={saved ? "Remove from my list" : "Save to my list"}
      title={saved ? "Remove from my list" : "Save to my list"}
      aria-pressed={saved}
      onClick={(e) => {
        e.stopPropagation();
        list.toggle(id);
      }}
    >
      <Pixel art={STAR} size={large ? 2 : 2} />
      {large && (saved ? "Saved" : "Save")}
    </button>
  );
}
