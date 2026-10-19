import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Small chart kit for the profile page, built from plain HTML so it reflows on
 * phones. Every mark is focusable and shows the same tooltip on hover and focus;
 * every chart also has a table view, so no value is reachable only by hovering.
 * Colours: one series uses the site's grape; the ordered tiers use a validated
 * one-hue ramp (dataviz validator, light surface).
 */

export const SERIES = "#7c5ce6";
export const TIERS = ["#2e1c80", "#6446d8", "#a48def"] as const;

interface Tip {
  x: number;
  y: number;
  value: string;
  label: string;
}

/** One tooltip per chart: value first, label second. */
function useTip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const handlers = (value: string, label: string) => ({
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const box = e.currentTarget.closest(".chart-plot")!.getBoundingClientRect();
      setTip({ x: e.clientX - box.left, y: e.clientY - box.top, value, label });
    },
    onPointerLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const box = e.currentTarget.closest(".chart-plot")!.getBoundingClientRect();
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ x: r.left - box.left + r.width / 2, y: r.top - box.top, value, label });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
    "aria-label": `${label}: ${value}`,
  });
  const node = tip ? (
    <div className="chart-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <strong>{tip.value}</strong>
      <span>{tip.label}</span>
    </div>
  ) : null;
  return { handlers, node };
}

export function ChartCard({
  title,
  subtitle,
  table,
  children,
  wide = false,
}: {
  title: string;
  subtitle?: ReactNode;
  table?: { head: string[]; rows: (string | number)[][] };
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <figure className={`chart-card ${wide ? "wide" : ""}`}>
      <figcaption>
        <h3>{title}</h3>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </figcaption>
      {children}
      {table && table.rows.length > 0 && (
        <details className="chart-table">
          <summary>Show as table</summary>
          <table>
            <thead>
              <tr>
                {table.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </figure>
  );
}

/** Horizontal bars, one series, sorted by the caller. Value at the tip of each bar. */
export function HBars({
  rows,
  format,
  detail,
  onSelect,
}: {
  rows: { key: string | number; label: string; value: number }[];
  format: (v: number) => string;
  /** Extra tooltip line per row. */
  detail?: (key: string | number) => string;
  onSelect?: (key: string | number) => void;
}) {
  const { handlers, node } = useTip();
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="chart-plot hbars">
      {rows.map((r) => {
        const Label = onSelect ? "button" : "span";
        return (
          <div key={r.key} className="hbar-row">
            <Label className="hbar-label" title={r.label} {...(onSelect ? { onClick: () => onSelect(r.key) } : {})}>
              {r.label}
            </Label>
            <div className="hbar-track">
              <div
                className="hbar"
                style={{ width: `${(r.value / max) * 100}%`, background: SERIES }}
                {...handlers(format(r.value), detail ? `${r.label} · ${detail(r.key)}` : r.label)}
              />
              <span className="hbar-value">{format(r.value)}</span>
            </div>
          </div>
        );
      })}
      {node}
    </div>
  );
}

/** Rounds a max up to a clean axis top (1, 2, 2.5, 5 × 10^n). */
function niceTop(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((t) => t >= v)!;
}

/** Columns over an ordered axis (years). Labels every few columns so they never collide. */
export function Columns({
  columns,
  format,
  unit = "",
  detail,
}: {
  columns: { key: number; label: string; value: number }[];
  format: (v: number) => string;
  /** Appended to the value in the tooltip ("12 games"). */
  unit?: string;
  detail?: (key: number) => string;
}) {
  const { handlers, node } = useTip();
  const top = niceTop(Math.max(0, ...columns.map((c) => c.value)));
  // Label every n-th column, with n chosen from the real width so labels never touch.
  const axis = useRef<HTMLDivElement>(null);
  const [every, setEvery] = useState(Math.max(1, Math.ceil(columns.length / 10)));
  useEffect(() => {
    const el = axis.current;
    if (!el) return;
    const fit = () => setEvery(Math.max(1, Math.ceil(columns.length / Math.max(1, Math.floor(el.clientWidth / 46)))));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns.length]);
  const ticks = [top, top / 2, 0];
  return (
    <div className="chart-plot columns">
      <div className="col-grid" aria-hidden="true">
        {ticks.map((t) => (
          <div key={t} className="col-gridline">
            <span>{format(t)}</span>
          </div>
        ))}
      </div>
      <div className="col-bars">
        {columns.map((c) => (
          <div key={c.key} className="col-slot">
            <div
              className="col"
              style={{ height: `${(c.value / top) * 100}%`, background: SERIES }}
              {...handlers(`${format(c.value)}${unit}`, detail ? `${c.label} · ${detail(c.key)}` : c.label)}
            />
          </div>
        ))}
      </div>
      <div className="col-axis" aria-hidden="true" ref={axis}>
        {columns.map((c, i) => (
          <span key={c.key}>{i % every === 0 ? c.label : ""}</span>
        ))}
      </div>
      {node}
    </div>
  );
}

/** One stacked bar of ordered tiers summing to 1, with a legend that labels every tier. */
export function TierBar({ tiers }: { tiers: { label: string; share: number }[] }) {
  const { handlers, node } = useTip();
  const pct = (s: number) => `${Math.round(s * 100)}%`;
  return (
    <div className="chart-plot tierbar">
      <div className="tier-track">
        {tiers.map((t, i) =>
          t.share > 0 ? (
            <div key={t.label} className="tier" style={{ flexGrow: t.share, background: TIERS[i] }} {...handlers(pct(t.share), t.label)} />
          ) : null,
        )}
      </div>
      <ul className="chart-legend">
        {tiers.map((t, i) => (
          <li key={t.label}>
            <span className="swatch" style={{ background: TIERS[i] }} />
            <strong>{pct(t.share)}</strong> {t.label}
          </li>
        ))}
      </ul>
      {node}
    </div>
  );
}
