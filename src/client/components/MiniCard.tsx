import { useState } from "react";
import type { GameSummary } from "../../shared/types.ts";
import { reviewLabel } from "../format.ts";
import { HEART, Pixel } from "../pixel.tsx";
import { Price } from "./ResultCard.tsx";
import { SaveButton } from "./SaveButton.tsx";

/** Compact card for shelves and "similar games" rows. */
export function MiniCard({ game, currency, onOpen }: { game: GameSummary; currency: string; onOpen: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const review = reviewLabel(game.reviewPct, game.reviewCount);
  return (
    <article className="mini-card" onClick={onOpen}>
      <div className="mini-thumb">
        {game.image && !imageFailed ? (
          <img src={game.image} alt="" loading="lazy" onError={() => setImageFailed(true)} />
        ) : (
          <div className="no-image">{game.name}</div>
        )}
        <SaveButton id={game.id} />
        <Price game={game} currency={currency} />
      </div>
      <div className="mini-name" title={game.name}>
        {game.name}
      </div>
      <div className="mini-meta">
        {game.reviewCount >= 10 ? (
          <span className={`liked tone-${review.tone}`} title={`${review.label}: ${game.reviewPct}% of ${game.reviewCount.toLocaleString()} reviews positive`}>
            <Pixel art={HEART} size={2} />
            {game.reviewPct}%
          </span>
        ) : (
          <span className="muted">Too new to tell</span>
        )}
        {game.tags[0] && <span className="mini-tag">{game.tags[0]}</span>}
      </div>
    </article>
  );
}
