import { serializeQuery, type SearchQuery } from "../shared/query.ts";
import type { BestOffer, MediaResponse, GameDetailResponse, GameSummary, MetaResponse, PricesResponse, SearchResponse } from "../shared/types.ts";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

function searchParams(query: SearchQuery, pageSize?: number) {
  const params = serializeQuery(query);
  if (pageSize) params.set("pageSize", String(pageSize));
  return params;
}

export const api = {
  meta: () => request<MetaResponse>("/api/meta"),
  search: (query: SearchQuery, opts: { signal?: AbortSignal; pageSize?: number; ids?: string[] } = {}) =>
    opts.ids
      ? request<SearchResponse>("/api/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ params: searchParams(query, opts.pageSize).toString(), ids: opts.ids }),
          signal: opts.signal,
        })
      : request<SearchResponse>(`/api/search?${searchParams(query, opts.pageSize)}`, { signal: opts.signal }),
  game: (id: string) => request<GameDetailResponse>(`/api/games/${encodeURIComponent(id)}`),
  prices: (id: string) => request<PricesResponse>(`/api/games/${encodeURIComponent(id)}/prices`),
  similar: (id: string) => request<GameSummary[]>(`/api/games/${encodeURIComponent(id)}/similar`),
  media: (id: string) => request<MediaResponse>(`/api/games/${encodeURIComponent(id)}/media`),
  bestOffers: (ids: string[]) =>
    request<Record<string, BestOffer | null>>("/api/prices/best", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    }),
  steamWishlist: (profile: string) =>
    request<{ steamId: string; ids: string[]; total: number }>(`/api/steam/wishlist?profile=${encodeURIComponent(profile)}`),
};
