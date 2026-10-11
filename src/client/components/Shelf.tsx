import { useEffect, useState } from "react";
import type { SearchQuery } from "../../shared/query.ts";
import type { GameSummary } from "../../shared/types.ts";
import { api } from "../api.ts";
import { MiniCard } from "./MiniCard.tsx";

interface Props {
  title: string;
  subtitle: string;
  query: SearchQuery;
  ids?: string[];
  currency: string;
  onOpen: (id: string) => void;
  onSeeAll: () => void;
}

export function Shelf({ title, subtitle, query, ids, currency, onOpen, onSeeAll }: Props) {
  const [games, setGames] = useState<GameSummary[] | null>(null);
  const [total, setTotal] = useState(0);
  const key = JSON.stringify([query, ids]);

  useEffect(() => {
    const ctrl = new AbortController();
    api.search(query, { pageSize: 16, ids, signal: ctrl.signal }).then(
      (r) => {
        setGames(r.results);
        setTotal(r.total);
      },
      () => !ctrl.signal.aborted && setGames([]),
    );
    return () => ctrl.abort();
  }, [key]);

  if (games && !games.length) return null;
  return (
    <section className="shelf">
      <div className="shelf-head">
        <div>
          <h2>{title}</h2>
          <p className="muted small">{subtitle}</p>
        </div>
        <button className="link-button" onClick={onSeeAll}>
          See all{total ? ` ${total.toLocaleString()}` : ""} →
        </button>
      </div>
      <div className="shelf-row">
        {games
          ? games.map((g) => <MiniCard key={g.id} game={g} currency={currency} onOpen={() => onOpen(g.id)} />)
          : Array.from({ length: 6 }, (_, i) => <div key={i} className="mini-card skeleton" />)}
      </div>
    </section>
  );
}
