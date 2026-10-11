import { serializeQuery, type SearchQuery } from "../shared/query.ts";
import type { GameDetailResponse, MetaResponse, PricesResponse, SearchResponse } from "../shared/types.ts";

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  meta: () => get<MetaResponse>("/api/meta"),
  search: (query: SearchQuery, signal?: AbortSignal) =>
    get<SearchResponse>(`/api/search?${serializeQuery(query)}`, signal),
  game: (id: string) => get<GameDetailResponse>(`/api/games/${encodeURIComponent(id)}`),
  prices: (id: string) => get<PricesResponse>(`/api/games/${encodeURIComponent(id)}/prices`),
};
