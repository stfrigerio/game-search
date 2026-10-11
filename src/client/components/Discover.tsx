import type { CSSProperties } from "react";
import { DEFAULT_QUERY, type SearchQuery } from "../../shared/query.ts";
import { useSavedList } from "../savedList.ts";
import { Gacha } from "./Gacha.tsx";
import { Shelf } from "./Shelf.tsx";

interface Props {
  gameCount: number;
  currency: string;
  onOpen: (id: string) => void;
  onSearch: (query: Partial<SearchQuery>) => void;
  onOpenList: (query: Partial<SearchQuery>) => void;
}

const year = new Date().getFullYear();

export const SHELVES: { title: string; subtitle: string; query: Partial<SearchQuery> }[] = [
  {
    title: "Best deals right now",
    subtitle: "Big discounts on games people actually like",
    query: { sort: "deal", discounted: true, minReviews: 200 },
  },
  {
    title: "Most played right now",
    subtitle: "Peak players on Steam yesterday",
    query: { sort: "players", minPlayers: 1000 },
  },
  {
    title: "Couch co-op night",
    subtitle: "Best rated local and split-screen co-op",
    query: { sort: "rating", features: ["localCoop"], minReviews: 200 },
  },
  {
    title: "Hidden gems",
    subtitle: "95%+ positive, but under 1,000 reviews",
    query: { sort: "rating", minPct: 95, minReviews: 50, maxReviews: 1000 },
  },
  {
    title: "Runs on a potato",
    subtitle: "Loved games that need next to no computer",
    query: { sort: "rating", power: ["low"], minReviews: 1000 },
  },
  {
    title: "Best of the past year",
    subtitle: `Top rated games released since ${year - 1}`,
    query: { sort: "rating", minYear: year - 1, minReviews: 200 },
  },
  {
    title: "Great Steam Deck games under $10",
    subtitle: "Deck Verified, well reviewed, cheap",
    query: { sort: "rating", deck: 3, maxPrice: 10, minReviews: 500, free: "exclude" },
  },
  {
    title: "Free and actually good",
    subtitle: "Free-to-play with strong reviews",
    query: { sort: "rating", free: "only", minReviews: 1000 },
  },
  {
    title: "DRM-free classics on GOG",
    subtitle: "Highest rated games you can buy without DRM",
    query: { sort: "rating", stores: ["gog"], minReviews: 500 },
  },
];

export function Discover({ gameCount, currency, onOpen, onSearch, onOpenList }: Props) {
  const list = useSavedList();
  const onSale: Partial<SearchQuery> = { sort: "deal", discounted: true };
  return (
    <div className="discover">
      <section className="hero">
        <div className="hero-copy">
          <h1 aria-label="Find a game worth your evening">
            {"Find a game worth your evening".split(" ").flatMap((word, i) => [
              <span key={i} aria-hidden="true" style={{ "--i": i } as CSSProperties}>
                {word}
              </span>,
              " ",
            ])}
          </h1>
          <p className="lede">
            {gameCount.toLocaleString()} games from Steam and GOG in one search. Filter by what you care about, then see
            which shop sells it cheapest.
          </p>
          <div className="hero-actions">
            <button className="primary" onClick={() => onSearch({ sort: "rating" })}>
              Browse everything
            </button>
            <button onClick={() => onSearch({ sort: "deal", discounted: true, minReviews: 200 })}>See what's on sale</button>
          </div>
        </div>
        <Gacha currency={currency} onOpen={onOpen} />
      </section>
      {list.ids.length > 0 && (
        <Shelf
          title="On sale from your list"
          subtitle="Games you saved that are discounted somewhere"
          query={{ ...DEFAULT_QUERY, ...onSale }}
          ids={list.ids}
          currency={currency}
          onOpen={onOpen}
          onSeeAll={() => onOpenList(onSale)}
        />
      )}
      {SHELVES.map((s) => (
        <Shelf
          key={s.title}
          title={s.title}
          subtitle={s.subtitle}
          query={{ ...DEFAULT_QUERY, ...s.query }}
          currency={currency}
          onOpen={onOpen}
          onSeeAll={() => onSearch(s.query)}
        />
      ))}
    </div>
  );
}
