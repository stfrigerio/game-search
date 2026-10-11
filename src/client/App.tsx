import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_QUERY, parseQuery, serializeQuery, SORTS, type SearchQuery, type SortKey } from "../shared/query.ts";
import type { MetaResponse, SearchResponse } from "../shared/types.ts";
import { api } from "./api.ts";
import { Filters } from "./components/Filters.tsx";
import { GameDetail } from "./components/GameDetail.tsx";
import { ResultCard } from "./components/ResultCard.tsx";
import { formatCount } from "./format.ts";

/** Search state lives in the URL so any search can be bookmarked or shared. */
function readUrl(): { query: SearchQuery; gameId: string | null } {
  const params = new URLSearchParams(location.search);
  return { query: parseQuery(params), gameId: params.get("game") };
}

function writeUrl(query: SearchQuery, gameId: string | null, push: boolean) {
  const params = serializeQuery(query);
  if (gameId) params.set("game", gameId);
  const url = `${location.pathname}${params.size ? `?${params}` : ""}`;
  if (url === `${location.pathname}${location.search}`) return;
  history[push ? "pushState" : "replaceState"](null, "", url);
}

export function App() {
  const [{ query, gameId }, setState] = useState(readUrl);
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qInput, setQInput] = useState(query.q);
  const [showFilters, setShowFilters] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPop = () => {
      const s = readUrl();
      setState(s);
      setQInput(s.query.q);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Poll catalogue status until it's ready (first start crawls for a few minutes).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const load = () =>
      api.meta().then(
        (m) => {
          setMeta(m);
          if (!m.gameCount || m.refreshing) timer = setTimeout(load, 5000);
        },
        () => (timer = setTimeout(load, 5000)),
      );
    load();
    return () => clearTimeout(timer);
  }, []);

  const update = useCallback(
    (patch: Partial<SearchQuery>, opts: { push?: boolean } = {}) => {
      const next = { ...query, page: 1, ...patch };
      writeUrl(next, null, opts.push ?? true);
      setState({ query: next, gameId: null });
    },
    [query],
  );

  // Debounce typing into the search box.
  useEffect(() => {
    if (qInput === query.q) return;
    const t = setTimeout(() => update({ q: qInput }, { push: false }), 250);
    return () => clearTimeout(t);
  }, [qInput, query.q, update]);

  const ready = !!meta?.gameCount;
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    setLoading(true);
    api.search(query, ctrl.signal).then(
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
  }, [query, ready]);

  const openGame = (id: string | null) => {
    writeUrl(query, id, true);
    setState({ query, gameId: id });
  };
  const addTag = (tag: string) => {
    if (!query.tags.includes(tag)) update({ tags: [...query.tags, tag], notTags: query.notTags.filter((t) => t !== tag) });
  };
  const goToPage = (page: number) => {
    update({ page });
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const currency = meta?.currency ?? "USD";
  const pages = response ? Math.ceil(response.total / response.pageSize) : 0;
  const activeFilters = [...serializeQuery({ ...query, q: "", sort: DEFAULT_QUERY.sort, page: 1 })].length;

  return (
    <div className="app" ref={topRef}>
      <header className="topbar">
        <a className="logo" href="/" onClick={(e) => (e.preventDefault(), setQInput(""), update({ ...DEFAULT_QUERY }))}>
          🎮 Game Search
        </a>
        <input
          className="search"
          type="search"
          autoFocus
          placeholder={ready ? `Search ${formatCount(meta.gameCount)} games by title, developer or publisher…` : "Search games…"}
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
        />
        <select value={query.sort} onChange={(e) => update({ sort: e.target.value as SortKey })} aria-label="Sort by">
          {Object.entries(SORTS).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <button className="filters-toggle" onClick={() => setShowFilters((s) => !s)}>
          Filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>
      </header>

      <div className="layout">
        <div className={`filters-wrap ${showFilters ? "open" : ""}`}>
          <Filters
            query={query}
            allTags={meta?.tags ?? []}
            facets={response?.tagFacets ?? []}
            currency={currency}
            onChange={update}
          />
        </div>

        <main>
          {!ready && (
            <div className="notice">
              <strong>Building the game catalogue…</strong>
              <p className="muted">
                The first start crawls every store, which takes a few minutes. {meta?.progress ?? ""}
              </p>
              {meta?.lastError && <p className="error">{meta.lastError}</p>}
            </div>
          )}
          {error && <p className="error">{error}</p>}
          {response && (
            <div className={`results ${loading ? "loading" : ""}`}>
              <div className="results-head muted">
                {response.total.toLocaleString()} {response.total === 1 ? "game" : "games"}
                {meta?.refreshing && " · refreshing catalogue in the background"}
              </div>
              {response.results.map((g) => (
                <ResultCard key={g.id} game={g} currency={currency} onOpen={() => openGame(g.id)} onTag={addTag} />
              ))}
              {response.total === 0 && <p className="muted">No games match. Try removing a filter.</p>}
              {pages > 1 && (
                <nav className="pager">
                  <button disabled={query.page <= 1} onClick={() => goToPage(query.page - 1)}>
                    ← Prev
                  </button>
                  <span>
                    Page {query.page} of {pages.toLocaleString()}
                  </span>
                  <button disabled={query.page >= pages} onClick={() => goToPage(query.page + 1)}>
                    Next →
                  </button>
                </nav>
              )}
            </div>
          )}
          {meta?.updatedAt && (
            <footer className="muted small">
              Catalogue updated {new Date(meta.updatedAt).toLocaleString()} ·{" "}
              {Object.entries(meta.storeCounts)
                .map(([s, n]) => `${s}: ${n.toLocaleString()}`)
                .join(" · ")}
            </footer>
          )}
        </main>
      </div>

      {gameId && <GameDetail id={gameId} currency={currency} onClose={() => openGame(null)} onTag={(t) => addTag(t)} />}
    </div>
  );
}
