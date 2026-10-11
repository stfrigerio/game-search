import type { ReactNode } from "react";
import { CONTENT_FILTERS, FEATURES, LANGUAGES, type FeatureGroup, type FeatureKey } from "../../shared/features.ts";
import { POWER } from "../../shared/power.ts";
import { DEFAULT_QUERY, type SearchQuery, type Tristate } from "../../shared/query.ts";
import type { SearchResponse, StoreId } from "../../shared/types.ts";
import { formatCount, STORE_NAMES } from "../format.ts";
import { Meter } from "./Meter.tsx";
import { TagPicker } from "./TagPicker.tsx";

interface Props {
  query: SearchQuery;
  allTags: { tag: string; count: number }[];
  response: SearchResponse | null;
  currency: string;
  /** Games whose power level was read from store requirements, out of `gameCount`. */
  specsRead: number;
  gameCount: number;
  onChange: (patch: Partial<SearchQuery>) => void;
}

/** A collapsible filter section; opens by default when it has an active filter. */
function Section({ title, active, defaultOpen, children }: { title: string; active: number; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="filter-section" open={defaultOpen || active > 0}>
      <summary>
        {title}
        {active > 0 && <span className="active-count">{active}</span>}
      </summary>
      <div className="filter-body">{children}</div>
    </details>
  );
}

/** One-tap preset buttons; tapping the active one clears it. */
function Presets<T>({
  options,
  isActive,
  onPick,
}: {
  options: { label: string; value: T }[];
  isActive: (v: T) => boolean;
  onPick: (v: T | null) => void;
}) {
  return (
    <div className="presets">
      {options.map((o) => {
        const active = isActive(o.value);
        return (
          <button key={o.label} className={`preset ${active ? "on" : ""}`} onClick={() => onPick(active ? null : o.value)}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
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

/**
 * A feature row cycles: off → required (✓) → excluded (✕) → off.
 * The count is how many current results have the feature.
 */
function FeatureList({
  group,
  query,
  counts,
  onChange,
}: {
  group: FeatureGroup;
  query: SearchQuery;
  counts: Record<string, number> | undefined;
  onChange: (patch: Partial<SearchQuery>) => void;
}) {
  const cycle = (key: FeatureKey) => {
    const features = query.features.filter((f) => f !== key);
    const notFeatures = query.notFeatures.filter((f) => f !== key);
    if (query.features.includes(key)) onChange({ features, notFeatures: [...notFeatures, key] });
    else if (query.notFeatures.includes(key)) onChange({ features, notFeatures });
    else onChange({ features: [...features, key], notFeatures });
  };
  return (
    <ul className="feature-list">
      {FEATURES.filter((f) => f.group === group).map((f) => {
        const state = query.features.includes(f.key) ? "on" : query.notFeatures.includes(f.key) ? "off" : "";
        const count = counts?.[f.key];
        return (
          <li key={f.key}>
            <button
              className={`feature ${state} ${count === 0 && !state ? "empty" : ""}`}
              onClick={() => cycle(f.key)}
              title={state === "on" ? "Required. Click to exclude instead" : state === "off" ? "Excluded. Click to clear" : "Click to require"}
            >
              <span className="box">{state === "on" ? "✓" : state === "off" ? "✕" : ""}</span>
              <span className="feature-label">{f.label}</span>
              {count !== undefined && !state && <span className="muted count">{formatCount(count)}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

const year = new Date().getFullYear();
const countFeatures = (q: SearchQuery, group: FeatureGroup) =>
  [...q.features, ...q.notFeatures].filter((k) => FEATURES.find((f) => f.key === k)?.group === group).length;
const isSet = (...values: unknown[]) =>
  values.filter((v) => v !== null && v !== false && v !== "" && !(Array.isArray(v) && !v.length)).length;

export function Filters({ query, allTags, response, currency, specsRead, gameCount, onChange }: Props) {
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const removeTag = (t: string) =>
    onChange({ tags: query.tags.filter((x) => x !== t), notTags: query.notTags.filter((x) => x !== t) });
  const facets = response?.tagFacets ?? [];
  const counts = response?.featureCounts;
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";

  return (
    <aside className="filters">
      <Section title="Tags" active={query.tags.length + query.notTags.length} defaultOpen>
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
            <div className="muted small">Common in these results. Click to add, right-click to exclude.</div>
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
                {f.tag} <span className="muted">{formatCount(f.count)}</span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section title="Reviews" active={isSet(query.minPct, query.minReviews, query.maxReviews)} defaultOpen>
        <div className="muted small">Positive reviews</div>
        <Presets
          options={[70, 80, 90, 95].map((v) => ({ label: `${v}%+`, value: v }))}
          isActive={(v) => query.minPct === v}
          onPick={(v) => onChange({ minPct: v })}
        />
        <div className="muted small">Number of reviews</div>
        <Presets
          options={[10, 100, 1000, 10000, 100000].map((v) => ({ label: `${formatCount(v)}+`, value: v }))}
          isActive={(v) => query.minReviews === v}
          onPick={(v) => onChange({ minReviews: v })}
        />
        <div className="row3">
          <label>
            Min %
            <NumberInput value={query.minPct} min={0} max={100} placeholder="0" onChange={(v) => onChange({ minPct: v })} />
          </label>
          <label>
            Min reviews
            <NumberInput value={query.minReviews} min={0} placeholder="0" onChange={(v) => onChange({ minReviews: v })} />
          </label>
          <label>
            Max reviews
            <NumberInput value={query.maxReviews} min={0} placeholder="any" onChange={(v) => onChange({ maxReviews: v })} />
          </label>
        </div>
      </Section>

      <Section title="Players" active={countFeatures(query, "players") + isSet(query.minPlayers)} defaultOpen>
        <div className="muted small">Playing right now (Steam peak yesterday)</div>
        <Presets
          options={[10, 100, 1000, 10000, 100000].map((v) => ({ label: `${formatCount(v)}+`, value: v }))}
          isActive={(v) => query.minPlayers === v}
          onPick={(v) => onChange({ minPlayers: v })}
        />
        <div className="muted small">Game modes</div>
        <FeatureList group="players" query={query} counts={counts} onChange={onChange} />
      </Section>

      <Section title="Computer needed" active={query.power.length} defaultOpen>
        <ul className="feature-list">
          {POWER.map((p) => {
            const on = query.power.includes(p.key);
            return (
              <li key={p.key}>
                <button className={`feature power-row ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onChange({ power: toggle(query.power, p.key) })}>
                  <span className="box">{on ? "✓" : ""}</span>
                  <span className="feature-label">
                    <Meter level={p.level} /> {p.label}
                    <span className="muted small power-hint">{p.hint}</span>
                  </span>
                  {response && <span className="muted count">{formatCount(response.powerCounts[p.key])}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="muted small">
          {specsRead >= gameCount * 0.9
            ? "Worked out from each store page's minimum requirements."
            : `Worked out from the store's minimum requirements for the ${formatCount(specsRead)} most reviewed games so far, and estimated from tags, age and price for the rest. More are read every day.`}
        </p>
      </Section>

      <Section
        title={`Price${currency ? ` (${currency})` : ""}`}
        active={isSet(query.minPrice, query.maxPrice, query.discounted, query.minDiscount) + (query.free !== DEFAULT_QUERY.free ? 1 : 0)}
        defaultOpen
      >
        <Presets
          options={[5, 10, 20, 30].map((v) => ({ label: `Under ${sym}${v}`, value: v }))}
          isActive={(v) => query.maxPrice === v && query.minPrice === null}
          onPick={(v) => onChange({ maxPrice: v, minPrice: null })}
        />
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
        <div className="muted small">Discount</div>
        <Presets
          options={[
            { label: "On sale", value: 1 },
            ...[25, 50, 75, 90].map((v) => ({ label: `${v}%+`, value: v })),
          ]}
          isActive={(v) => (v === 1 ? query.discounted && !query.minDiscount : query.minDiscount === v)}
          onPick={(v) =>
            onChange(v === null ? { discounted: false, minDiscount: null } : { discounted: true, minDiscount: v === 1 ? null : v })
          }
        />
        <label>
          Free games
          <TristateSelect value={query.free} onChange={(free) => onChange({ free })} labels={["Show", "Hide", "Only free"]} />
        </label>
      </Section>

      <Section
        title="Release"
        active={
          isSet(query.minYear, query.maxYear, query.days) +
          (query.upcoming !== DEFAULT_QUERY.upcoming ? 1 : 0) +
          (query.earlyAccess !== DEFAULT_QUERY.earlyAccess ? 1 : 0)
        }
      >
        <Presets
          options={[
            { label: "Last 30 days", value: 30 },
            { label: "3 months", value: 90 },
            { label: "1 year", value: 365 },
            { label: "5 years", value: 1826 },
          ]}
          isActive={(v) => query.days === v}
          onPick={(v) => onChange({ days: v })}
        />
        <div className="row">
          <label>
            From year
            <NumberInput value={query.minYear} placeholder="1980" onChange={(v) => onChange({ minYear: v })} />
          </label>
          <label>
            To year
            <NumberInput value={query.maxYear} placeholder={String(year)} onChange={(v) => onChange({ maxYear: v })} />
          </label>
        </div>
        <label>
          Upcoming
          <TristateSelect value={query.upcoming} onChange={(upcoming) => onChange({ upcoming })} labels={["Show", "Hide", "Only upcoming"]} />
        </label>
        <label>
          Early access
          <TristateSelect value={query.earlyAccess} onChange={(earlyAccess) => onChange({ earlyAccess })} labels={["Show", "Hide", "Only early access"]} />
        </label>
      </Section>

      <Section title="Platform & controls" active={query.platforms.length + (query.deck ? 1 : 0) + countFeatures(query, "controls")}>
        <div className="checks-row">
          {(["windows", "mac", "linux"] as const).map((p) => (
            <label key={p} className="check">
              <input type="checkbox" checked={query.platforms.includes(p)} onChange={() => onChange({ platforms: toggle(query.platforms, p) })} />
              {p === "mac" ? "macOS" : p[0].toUpperCase() + p.slice(1)}
            </label>
          ))}
        </div>
        <label>
          Steam Deck
          <select value={query.deck} onChange={(e) => onChange({ deck: Number(e.target.value) as SearchQuery["deck"] })}>
            <option value={0}>Any</option>
            <option value={2}>Playable or verified</option>
            <option value={3}>Verified only</option>
          </select>
        </label>
        <FeatureList group="controls" query={query} counts={counts} onChange={onChange} />
      </Section>

      <Section title="Language" active={query.lang ? 1 : 0}>
        <select value={query.lang ?? ""} onChange={(e) => onChange({ lang: e.target.value || null })}>
          <option value="">Any language</option>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
              {response && l.code !== query.lang ? ` (${formatCount(response.languageCounts[l.code] ?? 0)})` : ""}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={query.audio} onChange={(e) => onChange({ audio: e.target.checked })} />
          Full audio (voices) in this language
        </label>
        <p className="muted small">Language data comes from Steam; GOG-only games have none.</p>
      </Section>

      <Section title="Features" active={countFeatures(query, "features")}>
        <FeatureList group="features" query={query} counts={counts} onChange={onChange} />
      </Section>

      <Section title="Accessibility" active={countFeatures(query, "accessibility")}>
        <FeatureList group="accessibility" query={query} counts={counts} onChange={onChange} />
      </Section>

      <Section title="Hide content" active={query.hide.length}>
        {/* Porn first: it is the one most people reach for. */}
        {[...CONTENT_FILTERS].sort((a, b) => Number(b.key === "porn") - Number(a.key === "porn")).map((c) => (
          <label key={c.key} className="check">
            <input type="checkbox" checked={query.hide.includes(c.key)} onChange={() => onChange({ hide: toggle(query.hide, c.key) })} />
            {c.label}
          </label>
        ))}
      </Section>

      <Section title="Store" active={query.stores.length}>
        {(Object.keys(STORE_NAMES) as StoreId[]).map((s) => (
          <label key={s} className="check">
            <input type="checkbox" checked={query.stores.includes(s)} onChange={() => onChange({ stores: toggle(query.stores, s) })} />
            {STORE_NAMES[s]}
          </label>
        ))}
      </Section>
    </aside>
  );
}
