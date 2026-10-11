import { useState } from "react";
import { Pixel, STAR } from "../pixel.tsx";
import { useSavedList } from "../savedList.ts";

export function SaveButton({ id, large = false }: { id: string; large?: boolean }) {
  const list = useSavedList();
  const saved = list.has(id);
  // Only a star pressed just now celebrates, not every saved one on the page.
  const [justSaved, setJustSaved] = useState(false);
  return (
    <button
      className={`save ${saved ? "saved" : ""} ${saved && justSaved ? "just-saved" : ""} ${large ? "save-large" : ""}`}
      aria-label={saved ? "Remove from my list" : "Save to my list"}
      title={saved ? "Remove from my list" : "Save to my list"}
      aria-pressed={saved}
      onClick={(e) => {
        e.stopPropagation();
        setJustSaved(!saved);
        list.toggle(id);
      }}
    >
      <Pixel art={STAR} size={large ? 2 : 2} />
      {large && (saved ? "Saved" : "Save")}
    </button>
  );
}
