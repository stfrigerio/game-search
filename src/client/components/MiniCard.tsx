import { useState } from "react";
import type { GameSummary } from "../../shared/types.ts";
import { reviewLabel } from "../format.ts";
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
      </div>
      <div className="mini-name" title={game.name}>
        {game.name}
      </div>
      <div className="mini-meta">
        <span className={`tone-${review.tone}`}>{game.reviewCount >= 10 ? `${game.reviewPct}%` : "—"}</span>
        <Price game={game} currency={currency} />
      </div>
    </article>
  );
}
