import { useMemo, useState } from "react";

interface Props {
  allTags: { tag: string; count: number }[];
  included: string[];
  excluded: string[];
  onInclude: (tag: string) => void;
  onExclude: (tag: string) => void;
  onRemove: (tag: string) => void;
}

const MAX_SUGGESTIONS = 12;

export function TagPicker({ allTags, included, excluded, onInclude, onExclude, onRemove }: Props) {
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);

  const suggestions = useMemo(() => {
    const t = text.trim().toLowerCase();
    if (!t) return [];
    const chosen = new Set([...included, ...excluded].map((x) => x.toLowerCase()));
    const starts = [];
    const contains = [];
    for (const tag of allTags) {
      const name = tag.tag.toLowerCase();
      if (chosen.has(name)) continue;
      if (name.startsWith(t)) starts.push(tag);
      else if (name.includes(t)) contains.push(tag);
      if (starts.length >= MAX_SUGGESTIONS) break;
    }
    return [...starts, ...contains].slice(0, MAX_SUGGESTIONS);
  }, [text, allTags, included, excluded]);

  const pick = (tag: string, exclude: boolean) => {
    (exclude ? onExclude : onInclude)(tag);
    setText("");
    setActive(0);
  };

  return (
    <div className="tag-picker">
      <div className="chips">
        {included.map((t) => (
          <button key={t} className="chip chip-include" onClick={() => onRemove(t)} title="Remove">
            + {t} ×
          </button>
        ))}
        {excluded.map((t) => (
          <button key={t} className="chip chip-exclude" onClick={() => onRemove(t)} title="Remove">
            − {t} ×
          </button>
        ))}
      </div>
      <div className="tag-input-wrap">
        <input
          type="search"
          placeholder="Add a tag… (Shift+Enter to exclude)"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, suggestions.length - 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
            else if (e.key === "Enter" && suggestions[active]) pick(suggestions[active].tag, e.shiftKey);
            else if (e.key === "Escape") setText("");
            else return;
            e.preventDefault();
          }}
        />
        {suggestions.length > 0 && (
          <ul className="suggestions">
            {suggestions.map((s, i) => (
              <li key={s.tag} className={i === active ? "active" : ""} onMouseEnter={() => setActive(i)}>
                <button className="suggestion-main" onClick={() => pick(s.tag, false)}>
                  {s.tag} <span className="muted">{s.count.toLocaleString()}</span>
                </button>
                <button className="suggestion-exclude" title="Exclude this tag" onClick={() => pick(s.tag, true)}>
                  exclude
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
