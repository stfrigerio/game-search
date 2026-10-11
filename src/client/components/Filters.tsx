import { DEFAULT_QUERY, type SearchQuery, type Tristate } from "../../shared/query.ts";
import type { StoreId } from "../../shared/types.ts";
import { STORE_NAMES } from "../format.ts";
import { TagPicker } from "./TagPicker.tsx";

interface Props {
  query: SearchQuery;
  allTags: { tag: string; count: number }[];
  facets: { tag: string; count: number }[];
  currency: string;
  onChange: (patch: Partial<SearchQuery>) => void;
}

function NumberInput({
  value,
  onChange,
  placeholder,
  min,
  max,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  placeholder: string;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      placeholder={placeholder}
      min={min}
      max={max}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

function TristateSelect({ value, onChange, labels }: { value: Tristate; onChange: (v: Tristate) => void; labels: [string, string, string] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Tristate)}>
      <option value="include">{labels[0]}</option>
      <option value="exclude">{labels[1]}</option>
      <option value="only">{labels[2]}</option>
    </select>
  );
}

const REVIEW_PRESETS = [
  { label: "Any", minReviews: null, minPct: null },
  { label: "Mostly positive+", minReviews: 10, minPct: 70 },
  { label: "Very positive+", minReviews: 50, minPct: 80 },
  { label: "Overwhelmingly positive", minReviews: 500, minPct: 95 },
] as const;

export function Filters({ query, allTags, facets, currency, onChange }: Props) {
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const removeTag = (t: string) =>
    onChange({ tags: query.tags.filter((x) => x !== t), notTags: query.notTags.filter((x) => x !== t) });
  const preset = REVIEW_PRESETS.findIndex((p) => p.minReviews === query.minReviews && p.minPct === query.minPct);

  return (
    <aside className="filters">
      <section>
        <h3>Tags</h3>
        <TagPicker
          allTags={allTags}
          included={query.tags}
          excluded={query.notTags}
          onInclude={(t) => onChange({ tags: [...query.tags, t] })}
          onExclude={(t) => onChange({ notTags: [...query.notTags, t] })}
          onRemove={removeTag}
        />
        {facets.length > 0 && (
          <div className="facets">
            <div className="muted small">Narrow down (click to add, right-click to exclude)</div>
            {facets.slice(0, 24).map((f) => (
              <button
                key={f.tag}
                className="facet"
                onClick={() => onChange({ tags: [...query.tags, f.tag] })}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!query.notTags.includes(f.tag)) onChange({ notTags: [...query.notTags, f.tag] });
                }}
              >
                {f.tag} <span className="muted">{f.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <h3>Reviews</h3>
        <select
          value={preset}
          onChange={(e) => {
            const p = REVIEW_PRESETS[Number(e.target.value)];
            if (p) onChange({ minReviews: p.minReviews, minPct: p.minPct });
          }}
        >
          {REVIEW_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
          {preset === -1 && <option value={-1}>Custom</option>}
        </select>
        <div className="row">
          <label>
            Min reviews
            <NumberInput value={query.minReviews} min={0} placeholder="0" onChange={(v) => onChange({ minReviews: v })} />
          </label>
          <label>
            Min % positive
            <NumberInput value={query.minPct} min={0} max={100} placeholder="0" onChange={(v) => onChange({ minPct: v })} />
          </label>
        </div>
      </section>

      <section>
        <h3>Price ({currency})</h3>
        <div className="row">
          <label>
            Min
            <NumberInput value={query.minPrice} min={0} placeholder="0" onChange={(v) => onChange({ minPrice: v })} />
          </label>
          <label>
            Max
            <NumberInput value={query.maxPrice} min={0} placeholder="any" onChange={(v) => onChange({ maxPrice: v })} />
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={query.discounted} onChange={(e) => onChange({ discounted: e.target.checked })} />
          On sale
        </label>
        <label>
          Free games
          <TristateSelect value={query.free} onChange={(free) => onChange({ free })} labels={["Show", "Hide", "Only free"]} />
        </label>
      </section>

      <section>
        <h3>Release</h3>
        <div className="row">
          <label>
            From year
            <NumberInput value={query.minYear} placeholder="1980" onChange={(v) => onChange({ minYear: v })} />
          </label>
          <label>
            To year
            <NumberInput value={query.maxYear} placeholder="now" onChange={(v) => onChange({ maxYear: v })} />
          </label>
        </div>
        <label>
          Upcoming
          <TristateSelect value={query.upcoming} onChange={(upcoming) => onChange({ upcoming })} labels={["Show", "Hide", "Only upcoming"]} />
        </label>
        <label>
          Early access
          <TristateSelect
            value={query.earlyAccess}
            onChange={(earlyAccess) => onChange({ earlyAccess })}
            labels={["Show", "Hide", "Only early access"]}
          />
        </label>
      </section>

      <section>
        <h3>Platform</h3>
        {(["windows", "mac", "linux"] as const).map((p) => (
          <label key={p} className="check">
            <input
              type="checkbox"
              checked={query.platforms.includes(p)}
              onChange={() => onChange({ platforms: toggle(query.platforms, p) })}
            />
            {p === "mac" ? "macOS" : p[0].toUpperCase() + p.slice(1)}
          </label>
        ))}
        <label>
          Steam Deck
          <select value={query.deck} onChange={(e) => onChange({ deck: Number(e.target.value) as SearchQuery["deck"] })}>
            <option value={0}>Any</option>
            <option value={2}>Playable or verified</option>
            <option value={3}>Verified only</option>
          </select>
        </label>
      </section>

      <section>
        <h3>Store</h3>
        {(Object.keys(STORE_NAMES) as StoreId[]).map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={query.stores.includes(s)} onChange={() => onChange({ stores: toggle(query.stores, s) })} />
            {STORE_NAMES[s]}
          </label>
        ))}
      </section>

      <button className="link-button" onClick={() => onChange({ ...DEFAULT_QUERY, q: query.q, sort: query.sort })}>
        Reset filters
      </button>
    </aside>
  );
}
