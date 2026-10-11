import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_QUERY, parseQuery, serializeQuery, SORTS, type SearchQuery, type SortKey } from "../shared/query.ts";
import type { BestOffer, MetaResponse, SearchResponse } from "../shared/types.ts";
import { api } from "./api.ts";
import { Discover } from "./components/Discover.tsx";
import { ActiveFilters, describeFilters, QuickFilters } from "./components/FilterChips.tsx";
import { Filters } from "./components/Filters.tsx";
import { GameDetail } from "./components/GameDetail.tsx";
import { ResultCard } from "./components/ResultCard.tsx";
import { SteamImport } from "./components/SteamImport.tsx";
import { formatCount, STORE_NAMES } from "./format.ts";
import { BUDDY, BUDDY_BLINK, Pixel, SLIME, SLIME_BLINK } from "./pixel.tsx";
import { useSavedList } from "./savedList.ts";

type View = "discover" | "search" | "list";

interface UrlState {
  view: View;
  query: SearchQuery;
  gameId: string | null;
}

/** All state lives in the URL so any search can be bookmarked or shared. */
function readUrl(): UrlState {
  const params = new URLSearchParams(location.search);
  const query = parseQuery(params);
  const isDefault = serializeQuery(query).size === 0;
  const view: View = params.get("view") === "list" ? "list" : isDefault ? "discover" : "search";
  // Wishlists are full of unreleased games, so the list shows them unless told otherwise.
  if (view === "list" && !params.has("upcoming")) query.upcoming = "include";
  return { view, query, gameId: params.get("game") };
}

function urlFor({ view, query, gameId }: UrlState): string {
  const params = serializeQuery(query);
  if (view === "list") params.set("view", "list");
  if (gameId) params.set("game", gameId);
  return `${location.pathname}${params.size ? `?${params}` : ""}`;
}

export function App() {
  const [state, setState] = useState(readUrl);
  const { view, query, gameId } = state;
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  // Until the server has answered once there is nothing to say, not even "still loading".
  const [asked, setAsked] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState(query.q);
  const [offers, setOffers] = useState<Record<string, BestOffer | null>>({});
  const [showFilters, setShowFilters] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const list = useSavedList();

  const navigate = useCallback((next: UrlState, push = true, historyState: unknown = null) => {
    const url = urlFor(next);
    if (url !== `${location.pathname}${location.search}`) {
      history[push ? "pushState" : "replaceState"](historyState, "", url);
    }
    setState(next);
  }, []);

  useEffect(() => {
    const onPop = () => {
      const s = readUrl();
      setState(s);
      setQInput(s.query.q);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // "/" focuses the search box, like on most sites.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Poll catalogue status until it's ready (first start crawls for a few minutes).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api.meta().then(
        (m) => {
          setAsked(true);
          setMeta(m);
          if (!m.gameCount || m.refreshing) timer = setTimeout(load, 5000);
        },
        () => {
          setAsked(true);
          timer = setTimeout(load, 5000);
        },
      );
    load();
    return () => clearTimeout(timer);
  }, []);

  /** Change the query; leaves Discover for Search, keeps the list view on the list. */
  const update = useCallback(
    (patch: Partial<SearchQuery>, opts: { push?: boolean } = {}) => {
      const nextQuery = { ...query, page: 1, ...patch };
      const isDefault = serializeQuery(nextQuery).size === 0;
      const nextView: View = view === "list" ? "list" : isDefault ? "discover" : "search";
      navigate({ view: nextView, query: nextQuery, gameId: null }, opts.push ?? true);
    },
    [query, view, navigate],
  );

  // Debounce typing into the search box.
  useEffect(() => {
    if (qInput === query.q) return;
    const t = setTimeout(() => update({ q: qInput }, { push: view !== "search" }), 250);
    return () => clearTimeout(t);
  }, [qInput, query.q, update, view]);

  const ready = !!meta?.gameCount;
  const listKey = view === "list" ? list.ids.join(",") : "";
  useEffect(() => {
    if (!ready || view === "discover") return;
    const ctrl = new AbortController();
    setLoading(true);
    api.search(query, { signal: ctrl.signal, ids: view === "list" ? list.ids : undefined }).then(
      (r) => {
        setResponse(r);
        setError(null);
        setLoading(false);
      },
      (e) => {
        if (ctrl.signal.aborted) return;
        setError(String(e.message ?? e));
        setLoading(false);
      },
    );
    return () => ctrl.abort();
    // list.ids is tracked through listKey so a new array with the same ids doesn't refetch.
  }, [query, ready, view, listKey]);

  // On the list, look up the cheapest price anywhere for the games on screen.
  useEffect(() => {
    if (view !== "list" || !response?.results.length) return;
    const ids = response.results.map((g) => g.id).filter((id) => !(id in offers));
    if (!ids.length) return;
    let live = true;
    api.bestOffers(ids).then((found) => live && setOffers((o) => ({ ...o, ...found })), () => {});
    return () => {
      live = false;
    };
  }, [view, response]);

  // Opening a game pushes a history entry so Back closes it; closing pops that entry.
  const openGame = (id: string) => navigate({ ...state, gameId: id }, true, { modal: true });
  const closeGame = () => {
    if ((history.state as { modal?: boolean } | null)?.modal) history.back();
    else navigate({ ...state, gameId: null }, false);
  };
  const addTag = (tag: string) => {
    if (!query.tags.includes(tag)) update({ tags: [...query.tags, tag], notTags: query.notTags.filter((t) => t !== tag) });
  };
  const goToPage = (page: number) => {
    update({ page });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goDiscover = () => {
    setQInput("");
    navigate({ view: "discover", query: DEFAULT_QUERY, gameId: null });
  };
  const goList = (patch: Partial<SearchQuery> = {}) => {
    setQInput("");
    navigate({ view: "list", query: { ...DEFAULT_QUERY, upcoming: "include", ...patch }, gameId: null });
  };
  const goSearch = (patch: Partial<SearchQuery>) => {
    setQInput(patch.q ?? "");
    navigate({ view: "search", query: { ...DEFAULT_QUERY, ...patch }, gameId: null });
    window.scrollTo({ top: 0 });
  };

  // Typing a tag name ("roguelike", "co-op") offers to filter by that tag instead.
  const tagSuggestions = (() => {
    const t = query.q.trim().toLowerCase();
    if (t.length < 3 || !meta) return [];
    return meta.tags
      .filter((x) => x.tag.toLowerCase().includes(t) && !query.tags.includes(x.tag))
      .sort((a, b) => Number(b.tag.toLowerCase().startsWith(t)) - Number(a.tag.toLowerCase().startsWith(t)) || b.count - a.count)
      .slice(0, 4);
  })();
  const filterByTag = (tag: string) => {
    setQInput("");
    update({ q: "", tags: [...query.tags, tag], sort: query.sort === "relevance" ? "rating" : query.sort });
  };

  const currency = meta?.currency ?? "USD";
  const pages = response ? Math.ceil(response.total / response.pageSize) : 0;
  const activeFilters = describeFilters(query, meta?.currency ?? "USD").length;

  return (
    <div className="app">
      <header className="topbar">
        <a
          className="logo"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            goDiscover();
          }}
        >
          <Pixel art={BUDDY} alt={BUDDY_BLINK} size={3} className="blinks" />
          <span>game search</span>
        </a>
        <label className="search-box">
          <span className="visually-hidden">Search games</span>
          <input
            ref={searchRef}
            className="search"
            type="search"
            placeholder={
              view === "list"
                ? "Search your list"
                : ready
                  ? `Search ${formatCount(meta.gameCount)} games by title, developer or publisher`
                  : "Search games"
            }
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <kbd title="Press / to search">/</kbd>
        </label>
        <nav className="tabs">
          <button className={view === "discover" ? "active" : ""} onClick={goDiscover}>
            Discover
          </button>
          <button className={view === "search" ? "active" : ""} onClick={() => goSearch({ sort: "rating" })}>
            Browse
          </button>
          <button className={view === "list" ? "active" : ""} onClick={() => goList()}>
            My list{list.ids.length ? <span className="tab-count">{list.ids.length}</span> : null}
          </button>
        </nav>
      </header>

      {asked && !ready && (
        <div className="layout single">
          <div className="notice">
            <Pixel art={SLIME} alt={SLIME_BLINK} size={7} className="blinks squish" />
            {meta?.refreshing ? (
              <>
                <h1>Stocking the shelves</h1>
                <p className="muted">
                  The first crawl of every store takes about 8 minutes. This page fills in by itself when it is done.
                </p>
                {meta.progress && <p className="progress-line">{meta.progress}</p>}
              </>
            ) : (
              <>
                <h1>The shelves are empty</h1>
                <p className="muted">
                  {meta ? "No catalogue yet: run the crawl on the server (npm run crawl)." : "Connecting to the server…"}
                </p>
              </>
            )}
            {meta?.lastError && <p className="error">{meta.lastError}</p>}
          </div>
        </div>
      )}

      {ready && view === "discover" && (
        <div className="layout single">
          <Discover gameCount={meta.gameCount} currency={currency} onOpen={openGame} onSearch={goSearch} onOpenList={goList} />
        </div>
      )}

      {ready && view !== "discover" && (
        <div className="layout">
          <div className={`filters-wrap ${showFilters ? "open" : ""}`}>
            <Filters
              query={query}
              allTags={meta?.tags ?? []}
              response={response}
              currency={currency}
              specsRead={meta?.specsRead ?? 0}
              gameCount={meta?.gameCount ?? 0}
              onChange={update}
            />
          </div>

          <main>
            {view === "list" && <SteamImport />}
            <QuickFilters query={query} currency={currency} onChange={update} />
            <ActiveFilters query={query} currency={currency} onChange={update} />
            <div className="results-bar">
              <span className="muted">
                {response ? `${response.total.toLocaleString()} ${response.total === 1 ? "game" : "games"}` : ""}
                {view === "list" && list.ids.length > 0 && response && response.total < list.ids.length
                  ? ` of ${list.ids.length} saved`
                  : ""}
              </span>
              <div className="results-controls">
                <button className="filters-toggle" onClick={() => setShowFilters((s) => !s)}>
                  Filters{activeFilters ? ` (${activeFilters})` : ""}
                </button>
                <select value={query.sort} onChange={(e) => update({ sort: e.target.value as SortKey })} aria-label="Sort by">
                  {Object.entries(SORTS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {tagSuggestions.length > 0 && (
              <div className="tag-suggest">
                <span className="muted small">Did you mean the tag?</span>
                {tagSuggestions.map((t) => (
                  <button key={t.tag} className="facet" onClick={() => filterByTag(t.tag)}>
                    {t.tag} <span className="muted">{t.count.toLocaleString()}</span>
                  </button>
                ))}
              </div>
            )}
            {error && <p className="error">{error}</p>}
            {response && (
              <div className={`results ${loading ? "loading" : ""}`}>
                {response.results.map((g) => (
                  <ResultCard
                    key={g.id}
                    game={g}
                    currency={currency}
                    onOpen={() => openGame(g.id)}
                    onTag={addTag}
                    onDev={(dev) => update({ dev })}
                    offer={view === "list" ? offers[g.id] : undefined}
                  />
                ))}
                {response.total === 0 && (
                  <div className="empty">
                    <Pixel art={SLIME} alt={SLIME_BLINK} size={6} className="blinks squish" />
                    {view === "list" && !list.ids.length ? (
                      <p>Nothing saved yet. Press the star on any game to keep it here, or import your Steam wishlist above.</p>
                    ) : (
                      <>
                        <p>No game matches all of that. Loosen a filter or two.</p>
                        {activeFilters > 0 && (
                          <button className="primary" onClick={() => update({ ...DEFAULT_QUERY, q: query.q, sort: query.sort })}>
                            Clear {activeFilters} filter{activeFilters > 1 ? "s" : ""}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                {pages > 1 && (
                  <nav className="pager">
                    <button disabled={query.page <= 1} onClick={() => goToPage(query.page - 1)}>
                      Previous
                    </button>
                    <span>
                      Page {query.page} of {pages.toLocaleString()}
                    </span>
                    <button disabled={query.page >= pages} onClick={() => goToPage(query.page + 1)}>
                      Next
                    </button>
                  </nav>
                )}
                {view === "list" && list.ids.length > 0 && (
                  <p className="muted small list-footer">
                    Your list is stored in this browser.{" "}
                    <button
                      className="link-button"
                      onClick={() => confirm(`Remove all ${list.ids.length} games from your list?`) && list.clear()}
                    >
                      Clear list
                    </button>
                  </p>
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {meta?.updatedAt && (
        <footer>
          <p>
            Catalogue read on {new Date(meta.updatedAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}:{" "}
            {Object.entries(meta.storeCounts)
              .map(([s, n]) => `${n.toLocaleString()} games on ${STORE_NAMES[s as keyof typeof STORE_NAMES] ?? s}`)
              .join(", ")}
            .
          </p>
          <p>Prices from other shops come from CheapShark, in US dollars.</p>
        </footer>
      )}

      {gameId && (
        <GameDetail
          id={gameId}
          currency={currency}
          onClose={closeGame}
          onTag={addTag}
          onOpen={openGame}
          onDev={(dev) => {
            setQInput("");
            navigate({ view: "search", query: { ...DEFAULT_QUERY, dev, sort: "rating" }, gameId: null });
          }}
        />
      )}
    </div>
  );
}
