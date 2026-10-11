import type { StoreId } from "../shared/types.ts";

const formatters = new Map<string, Intl.NumberFormat>();

export function formatPrice(cents: number | null, currency: string): string {
  if (cents === null) return "—";
  if (cents === 0) return "Free";
  let fmt = formatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat(undefined, { style: "currency", currency });
    formatters.set(currency, fmt);
  }
  return fmt.format(cents / 100);
}

export function formatDate(ts: number | null, comingSoon: boolean): string {
  if (comingSoon) return ts ? `Coming ${new Date(ts * 1000).getFullYear()}` : "Coming soon";
  if (!ts) return "Unknown date";
  return new Date(ts * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function formatCount(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? "compact" : "standard" }).format(n);
}

export type ReviewTone = "positive" | "mixed" | "negative" | "none";

/** Steam's review summary wording, applied to the combined review count. */
export function reviewLabel(pct: number, count: number): { label: string; tone: ReviewTone } {
  if (count < 10) return { label: count ? `${count} user review${count > 1 ? "s" : ""}` : "No reviews", tone: "none" };
  if (pct >= 80) {
    if (pct >= 95 && count >= 500) return { label: "Overwhelmingly Positive", tone: "positive" };
    return { label: count >= 50 ? "Very Positive" : "Positive", tone: "positive" };
  }
  if (pct >= 70) return { label: "Mostly Positive", tone: "positive" };
  if (pct >= 40) return { label: "Mixed", tone: "mixed" };
  if (pct >= 20) return { label: "Mostly Negative", tone: "negative" };
  if (count >= 500) return { label: "Overwhelmingly Negative", tone: "negative" };
  return { label: count >= 50 ? "Very Negative" : "Negative", tone: "negative" };
}

export const STORE_NAMES: Record<StoreId, string> = { steam: "Steam", gog: "GOG" };

export const DECK_LABELS = ["", "Unsupported on Deck", "Deck Playable", "Deck Verified"] as const;
