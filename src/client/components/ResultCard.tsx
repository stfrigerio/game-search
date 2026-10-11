import { useState } from "react";
import type { GameSummary } from "../../shared/types.ts";
import { DECK_LABELS, formatCount, formatDate, formatPrice, reviewLabel, STORE_NAMES } from "../format.ts";

interface Props {
  game: GameSummary;
  currency: string;
  onOpen: () => void;
  onTag: (tag: string) => void;
}

export function Price({ game, currency }: { game: GameSummary; currency: string }) {
  if (game.free) return <span className="price">Free</span>;
  if (game.bestPrice === null) return <span className="price muted">—</span>;
  return (
    <span className="price">
      {game.bestDiscountPct > 0 && <span className="discount">−{game.bestDiscountPct}%</span>}
      {game.bestDiscountPct > 0 && <s className="muted">{formatPrice(game.bestBasePrice, currency)}</s>}
      <strong>{formatPrice(game.bestPrice, currency)}</strong>
    </span>
  );
}

export function ResultCard({ game, currency, onOpen, onTag }: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const review = reviewLabel(game.reviewPct, game.reviewCount);
  return (
    <article className="card" onClick={onOpen}>
      <div className="thumb">
        {game.image && !imageFailed ? (
          <img src={game.image} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <div className="no-image">{game.name}</div>
        )}
      </div>
      <div className="card-body">
        <div className="card-title">
          <h2>{game.name}</h2>
          <Price game={game} currency={currency} />
        </div>
        <div className="card-meta">
          <span className={`review tone-${review.tone}`} title={`${game.reviewPct}% of ${game.reviewCount.toLocaleString()} reviews positive`}>
            {review.label}
            {game.reviewCount >= 10 && (
              <span className="muted">
                {" "}
                · {game.reviewPct}% of {formatCount(game.reviewCount)}
              </span>
            )}
          </span>
          <span className="muted">{formatDate(game.releaseDate, game.comingSoon)}</span>
          {game.developers[0] && <span className="muted">{game.developers[0]}</span>}
        </div>
        <div className="card-tags">
          {game.tags.slice(0, 6).map((t) => (
            <button
              key={t}
              className="tag"
              onClick={(e) => {
                e.stopPropagation();
                onTag(t);
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="badges">
          {game.stores.map((s) => (
            <span key={s} className={`badge store-${s}`}>
              {STORE_NAMES[s]}
            </span>
          ))}
          {game.earlyAccess && <span className="badge">Early Access</span>}
          {game.deck >= 2 && <span className={`badge deck-${game.deck}`}>{DECK_LABELS[game.deck]}</span>}
          {game.platforms.linux && <span className="badge">Linux</span>}
          {game.platforms.mac && <span className="badge">macOS</span>}
        </div>
      </div>
    </article>
  );
}
