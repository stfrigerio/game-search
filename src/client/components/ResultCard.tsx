import { useState } from "react";
import type { BestOffer, GameSummary } from "../../shared/types.ts";
import { HEART, Pixel } from "../pixel.tsx";
import { PowerBadge } from "./Meter.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { DECK_LABELS, formatCount, formatDate, formatPrice, reviewLabel, saleEnds, STORE_NAMES } from "../format.ts";

interface Props {
  game: GameSummary;
  currency: string;
  onOpen: () => void;
  onTag: (tag: string) => void;
  onDev?: (dev: string) => void;
  /** Cheapest offer across official stores; undefined = not looked up, null = none found. */
  offer?: BestOffer | null;
}

export function Price({ game, currency }: { game: GameSummary; currency: string }) {
  if (game.free) return <span className="price free">Free</span>;
  if (game.bestPrice === null) return <span className="price none">No price</span>;
  return (
    <span className={`price ${game.bestDiscountPct > 0 ? "sale" : ""}`}>
      {game.bestDiscountPct > 0 && <span className="discount">−{game.bestDiscountPct}%</span>}
      {game.bestDiscountPct > 0 && <s>{formatPrice(game.bestBasePrice, currency)}</s>}
      <strong>{formatPrice(game.bestPrice, currency)}</strong>
    </span>
  );
}

export function ResultCard({ game, currency, onOpen, onTag, onDev, offer }: Props) {
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
          <div className="card-actions">
            <Price game={game} currency={currency} />
            <SaveButton id={game.id} />
          </div>
        </div>
        <div className="card-meta">
          <span className={`review tone-${review.tone}`} title={`${game.reviewPct}% of ${game.reviewCount.toLocaleString()} reviews positive`}>
            <Pixel art={HEART} size={2} />
            {review.label}
            {game.reviewCount >= 10 && (
              <span className="muted">
                {game.reviewPct}% of {formatCount(game.reviewCount)}
              </span>
            )}
          </span>
          <span className="muted">{formatDate(game.releaseDate, game.comingSoon)}</span>
          {game.developers[0] && (
            <button
              className="dev-link"
              title={`More by ${game.developers[0]}`}
              onClick={(e) => {
                e.stopPropagation();
                onDev?.(game.developers[0]);
              }}
            >
              {game.developers[0]}
            </button>
          )}
          {game.peakPlayers ? (
            <span className="muted" title="Peak concurrent players on Steam yesterday (SteamSpy)">
              {formatCount(game.peakPlayers)} playing
            </span>
          ) : null}
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
        {offer && <OfferLine offer={offer} game={game} currency={currency} />}
        <div className="badges">
          {game.stores.map((s) => (
            <span key={s} className={`badge store-${s}`}>
              {STORE_NAMES[s]}
            </span>
          ))}
          {saleEnds(game.bestDiscountEnds) && <span className="badge sale-ends">{saleEnds(game.bestDiscountEnds)}</span>}
          <PowerBadge level={game.power} known={game.powerKnown} />
          {game.earlyAccess && <span className="badge">Early Access</span>}
          {game.deck >= 2 && <span className={`badge deck-${game.deck}`}>{DECK_LABELS[game.deck]}</span>}
          {game.platforms.linux && <span className="badge">Linux</span>}
          {game.platforms.mac && <span className="badge">macOS</span>}
        </div>
      </div>
    </article>
  );
}

/** "Cheapest: $31.99 at GameBillet" — CheapShark prices are USD, so only compare when we're in USD too. */
function OfferLine({ offer, game, currency }: { offer: BestOffer; game: GameSummary; currency: string }) {
  const cheaper = currency === "USD" && game.bestPrice !== null && offer.price < game.bestPrice;
  const atLow = offer.historicLow !== null && offer.price <= offer.historicLow;
  return (
    <div className={`offer-line ${cheaper ? "cheaper" : ""}`}>
      <a href={offer.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
        {cheaper ? "Cheaper elsewhere: " : "Cheapest: "}
        <strong>{formatPrice(offer.price, "USD")}</strong> at {offer.shop}
        {offer.discountPct > 0 && ` (−${offer.discountPct}%)`}
      </a>
      {atLow ? (
        <span className="low-badge">Historic low</span>
      ) : (
        offer.historicLow !== null && <span className="muted">lowest ever {formatPrice(offer.historicLow, "USD")}</span>
      )}
    </div>
  );
}
