import { useEffect, useState } from "react";
import type { GameDetailResponse, GameSummary, PricesResponse } from "../../shared/types.ts";
import { api } from "../api.ts";
import { MiniCard } from "./MiniCard.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { DECK_LABELS, formatDate, formatPrice, reviewLabel, STORE_NAMES } from "../format.ts";

interface Props {
  id: string;
  currency: string;
  onClose: () => void;
  onTag: (tag: string) => void;
  onOpen: (id: string) => void;
}

const KIND_LABELS = {
  official: "Official stores",
  keyshop: "Key resellers",
  tracker: "Price trackers",
} as const;

export function GameDetail({ id, currency, onClose, onTag, onOpen }: Props) {
  const [detail, setDetail] = useState<GameDetailResponse | null>(null);
  const [prices, setPrices] = useState<PricesResponse | null>(null);
  const [similar, setSimilar] = useState<GameSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setPrices(null);
    setSimilar(null);
    setError(null);
    let live = true;
    api.game(id).then((d) => live && setDetail(d), (e) => live && setError(String(e.message ?? e)));
    api.prices(id).then((p) => live && setPrices(p), () => {});
    api.similar(id).then((s) => live && setSimilar(s), () => live && setSimilar([]));
    return () => {
      live = false;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const game = detail?.game;
  const summary = detail?.summary;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
        {error && <p className="error">{error}</p>}
        {!game || !summary ? (
          !error && <p className="muted">Loading…</p>
        ) : (
          <>
            {game.image && <img className="hero" src={game.image} alt="" />}
            <div className="detail-title">
              <h2>{game.name}</h2>
              <SaveButton id={game.id} large />
            </div>
            <p className="muted">
              {formatDate(game.releaseDate, game.comingSoon)}
              {game.developers.length > 0 && ` · ${game.developers.join(", ")}`}
              {game.publishers.length > 0 && game.publishers.join() !== game.developers.join() && ` · ${game.publishers.join(", ")}`}
            </p>
            {game.description && <p>{game.description}</p>}
            <div className="card-tags">
              {game.tags.map((t) => (
                <button key={t} className="tag" onClick={() => onTag(t)}>
                  {t}
                </button>
              ))}
            </div>
            <div className="badges">
              {game.earlyAccess && <span className="badge">Early Access</span>}
              {game.deck > 0 && <span className={`badge deck-${game.deck}`}>{DECK_LABELS[game.deck]}</span>}
              {(["windows", "mac", "linux"] as const)
                .filter((p) => game.platforms[p])
                .map((p) => (
                  <span key={p} className="badge">
                    {p === "mac" ? "macOS" : p[0].toUpperCase() + p.slice(1)}
                  </span>
                ))}
            </div>

            <h3>Stores</h3>
            <table className="prices">
              <tbody>
                {game.stores.map((s) => {
                  const r = reviewLabel(s.reviewPct, s.reviewCount);
                  return (
                    <tr key={s.store}>
                      <td>
                        <a href={s.url} target="_blank" rel="noreferrer">
                          {STORE_NAMES[s.store]}
                        </a>
                      </td>
                      <td className={`tone-${r.tone}`}>
                        {r.label}
                        {s.reviewCount >= 10 && <span className="muted"> ({s.reviewPct}% of {s.reviewCount.toLocaleString()})</span>}
                      </td>
                      <td className="num">
                        {s.discountPct > 0 && <span className="discount">−{s.discountPct}%</span>}{" "}
                        {s.free ? "Free" : formatPrice(s.price, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h3>Compare prices</h3>
            {!prices ? (
              <p className="muted">Checking other stores…</p>
            ) : (
              <>
                {prices.error && <p className="error small">{prices.error}</p>}
                {prices.offers.length > 0 && (
                  <table className="prices">
                    <tbody>
                      {prices.offers.map((o) => (
                        <tr key={o.shop}>
                          <td>
                            <a href={o.url} target="_blank" rel="noreferrer">
                              {o.shop}
                            </a>
                          </td>
                          <td className="num">
                            {o.discountPct > 0 && <span className="discount">−{o.discountPct}%</span>}{" "}
                            <strong>{formatPrice(o.price, prices.currency)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {prices.historicLow !== null && (
                  <p className="muted small">Historic low: {formatPrice(prices.historicLow, prices.currency)}</p>
                )}
                {prices.offers.length > 0 && <p className="muted small">Live prices via CheapShark, in {prices.currency}.</p>}
                {(["official", "keyshop", "tracker"] as const).map((kind) => {
                  const links = prices.links.filter((l) => l.kind === kind);
                  if (!links.length) return null;
                  return (
                    <div key={kind} className="link-group">
                      <div className="muted small">
                        {KIND_LABELS[kind]}
                        {kind === "keyshop" && " — grey-market keys: often cheaper, but the developer may not get paid"}
                      </div>
                      {links.map((l) => (
                        <a key={l.shop} className="shop-link" href={l.url} target="_blank" rel="noreferrer">
                          {l.shop} ↗
                        </a>
                      ))}
                    </div>
                  );
                })}
              </>
            )}

            {similar && similar.length > 0 && (
              <>
                <h3>Similar games</h3>
                <div className="similar-grid">
                  {similar.map((g) => (
                    <MiniCard key={g.id} game={g} currency={currency} onOpen={() => onOpen(g.id)} />
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
