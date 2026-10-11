import { CONTENT_FILTERS, FEATURE_BY_KEY, LANGUAGE_BY_CODE } from "../../shared/features.ts";
import { DEFAULT_QUERY, type SearchQuery } from "../../shared/query.ts";
import { formatCount, STORE_NAMES } from "../format.ts";

interface Chip {
  label: string;
  /** Patch that removes this filter. */
  clear: Partial<SearchQuery>;
  negative?: boolean;
}

/** Every active filter as a removable chip. */
export function describeFilters(q: SearchQuery, currency: string): Chip[] {
  const d = DEFAULT_QUERY;
  const money = (v: number) => new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(v);
  const chips: Chip[] = [];
  for (const t of q.tags) chips.push({ label: t, clear: { tags: q.tags.filter((x) => x !== t) } });
  for (const t of q.notTags) chips.push({ label: t, negative: true, clear: { notTags: q.notTags.filter((x) => x !== t) } });
  for (const f of q.features) {
    chips.push({ label: FEATURE_BY_KEY.get(f)?.label ?? f, clear: { features: q.features.filter((x) => x !== f) } });
  }
  for (const f of q.notFeatures) {
    chips.push({
      label: f === "iap" ? "No in-app purchases" : (FEATURE_BY_KEY.get(f)?.label ?? f),
      negative: f !== "iap",
      clear: { notFeatures: q.notFeatures.filter((x) => x !== f) },
    });
  }
  if (q.minPct !== null) chips.push({ label: `${q.minPct}%+ positive`, clear: { minPct: null } });
  if (q.minReviews !== null) chips.push({ label: `${formatCount(q.minReviews)}+ reviews`, clear: { minReviews: null } });
  if (q.maxReviews !== null) chips.push({ label: `≤ ${formatCount(q.maxReviews)} reviews`, clear: { maxReviews: null } });
  if (q.minPlayers !== null) chips.push({ label: `${formatCount(q.minPlayers)}+ playing`, clear: { minPlayers: null } });
  if (q.minPrice !== null && q.maxPrice !== null) {
    chips.push({ label: `${money(q.minPrice)}–${money(q.maxPrice)}`, clear: { minPrice: null, maxPrice: null } });
  } else if (q.maxPrice !== null) chips.push({ label: `Under ${money(q.maxPrice)}`, clear: { maxPrice: null } });
  else if (q.minPrice !== null) chips.push({ label: `Over ${money(q.minPrice)}`, clear: { minPrice: null } });
  if (q.minDiscount !== null) chips.push({ label: `${q.minDiscount}%+ off`, clear: { minDiscount: null, discounted: false } });
  else if (q.discounted) chips.push({ label: "On sale", clear: { discounted: false } });
  if (q.free !== d.free) chips.push({ label: q.free === "only" ? "Free only" : "No free games", clear: { free: d.free } });
  if (q.days !== null) chips.push({ label: `Released last ${q.days >= 365 ? `${Math.round(q.days / 365)}y` : `${q.days}d`}`, clear: { days: null } });
  if (q.minYear !== null || q.maxYear !== null) {
    chips.push({ label: `${q.minYear ?? "…"}–${q.maxYear ?? "now"}`, clear: { minYear: null, maxYear: null } });
  }
  if (q.upcoming !== d.upcoming) {
    chips.push({ label: q.upcoming === "only" ? "Upcoming only" : "Incl. upcoming", clear: { upcoming: d.upcoming } });
  }
  if (q.earlyAccess !== d.earlyAccess) {
    chips.push({ label: q.earlyAccess === "only" ? "Early access only" : "No early access", clear: { earlyAccess: d.earlyAccess } });
  }
  for (const p of q.platforms) {
    chips.push({ label: p === "mac" ? "macOS" : p[0].toUpperCase() + p.slice(1), clear: { platforms: q.platforms.filter((x) => x !== p) } });
  }
  if (q.deck) chips.push({ label: q.deck === 3 ? "Deck Verified" : "Deck Playable+", clear: { deck: 0 } });
  if (q.lang) {
    const name = LANGUAGE_BY_CODE.get(q.lang)?.name ?? q.lang;
    chips.push({ label: q.audio ? `${name} audio` : name, clear: { lang: null, audio: false } });
  }
  for (const h of q.hide) {
    chips.push({
      label: `Hide ${CONTENT_FILTERS.find((c) => c.key === h)?.label.toLowerCase() ?? h}`,
      clear: { hide: q.hide.filter((x) => x !== h) },
    });
  }
  for (const s of q.stores) chips.push({ label: STORE_NAMES[s], clear: { stores: q.stores.filter((x) => x !== s) } });
  if (q.dev) chips.push({ label: `By ${q.dev}`, clear: { dev: "" } });
  return chips;
}

export function ActiveFilters({
  query,
  currency,
  onChange,
}: {
  query: SearchQuery;
  currency: string;
  onChange: (patch: Partial<SearchQuery>) => void;
}) {
  const chips = describeFilters(query, currency);
  if (!chips.length) return null;
  return (
    <div className="active-filters">
      {chips.map((c) => (
        <button key={c.label} className={`chip ${c.negative ? "chip-exclude" : "chip-include"}`} onClick={() => onChange(c.clear)} title="Remove filter">
          {c.label} <span className="x">×</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button className="link-button" onClick={() => onChange({ ...DEFAULT_QUERY, q: query.q, sort: query.sort, upcoming: query.upcoming })}>
          Clear all
        </button>
      )}
    </div>
  );
}

/** One-tap toggles for the filters people reach for most. */
const QUICK: { label: string; on: (q: SearchQuery) => boolean; toggle: (q: SearchQuery, on: boolean) => Partial<SearchQuery> }[] = [
  {
    label: "Co-op",
    on: (q) => q.features.includes("coop"),
    toggle: (q, on) => ({ features: on ? q.features.filter((f) => f !== "coop") : [...q.features, "coop"] }),
  },
  {
    label: "Single-player",
    on: (q) => q.features.includes("single"),
    toggle: (q, on) => ({ features: on ? q.features.filter((f) => f !== "single") : [...q.features, "single"] }),
  },
  {
    label: "Very positive",
    on: (q) => q.minPct === 80 && q.minReviews === 50,
    toggle: (_q, on) => (on ? { minPct: null, minReviews: null } : { minPct: 80, minReviews: 50 }),
  },
  {
    label: "Popular now",
    on: (q) => q.minPlayers === 1000,
    toggle: (_q, on) => ({ minPlayers: on ? null : 1000 }),
  },
  { label: "On sale", on: (q) => q.discounted, toggle: (_q, on) => ({ discounted: !on, minDiscount: null }) },
  { label: "Under 10", on: (q) => q.maxPrice === 10, toggle: (_q, on) => ({ maxPrice: on ? null : 10 }) },
  { label: "Deck Verified", on: (q) => q.deck === 3, toggle: (_q, on) => ({ deck: on ? 0 : 3 }) },
  {
    label: "Controller",
    on: (q) => q.features.includes("controllerFull"),
    toggle: (q, on) => ({
      features: on ? q.features.filter((f) => f !== "controllerFull") : [...q.features, "controllerFull"],
    }),
  },
  {
    label: "No microtransactions",
    on: (q) => q.notFeatures.includes("iap"),
    toggle: (q, on) => ({ notFeatures: on ? q.notFeatures.filter((f) => f !== "iap") : [...q.notFeatures, "iap"] }),
  },
  { label: "New this year", on: (q) => q.days === 365, toggle: (_q, on) => ({ days: on ? null : 365 }) },
];

export function QuickFilters({
  query,
  currency,
  onChange,
}: {
  query: SearchQuery;
  currency: string;
  onChange: (patch: Partial<SearchQuery>) => void;
}) {
  const ten = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(10);
  return (
    <div className="quick-filters">
      {QUICK.map((f) => {
        const on = f.on(query);
        return (
          <button key={f.label} className={`quick ${on ? "on" : ""}`} aria-pressed={on} onClick={() => onChange(f.toggle(query, on))}>
            {f.label === "Under 10" ? `Under ${ten}` : f.label}
          </button>
        );
      })}
    </div>
  );
}
