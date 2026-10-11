import { useSavedList } from "../savedList.ts";

export function SaveButton({ id, large = false }: { id: string; large?: boolean }) {
  const list = useSavedList();
  const saved = list.has(id);
  return (
    <button
      className={`save ${saved ? "saved" : ""} ${large ? "save-large" : ""}`}
      title={saved ? "Remove from my list" : "Save to my list"}
      aria-pressed={saved}
      onClick={(e) => {
        e.stopPropagation();
        list.toggle(id);
      }}
    >
      {saved ? "★" : "☆"}
      {large && (saved ? " Saved" : " Save")}
    </button>
  );
}
