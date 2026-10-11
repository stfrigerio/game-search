import { useEffect, useState } from "react";
import type { GameDetailResponse, GameSummary, PricesResponse } from "../../shared/types.ts";
import { api } from "../api.ts";
import { FEATURE_GROUPS, FEATURES, LANGUAGE_BY_CODE, type FeatureGroup } from "../../shared/features.ts";
import { POWER_BY_LEVEL } from "../../shared/power.ts";
import { MediaGallery } from "./MediaGallery.tsx";
import { Meter } from "./Meter.tsx";
import { MiniCard } from "./MiniCard.tsx";
import { SaveButton } from "./SaveButton.tsx";
import { DECK_LABELS, formatDate, formatPrice, reviewLabel, saleEnds, STORE_NAMES } from "../format.ts";

interface Props {
  id: string;
  currency: string;
  onClose: () => void;
  onTag: (tag: string) => void;
  onOpen: (id: string) => void;
  onDev: (dev: string) => void;
}

const KIND_LABELS = {
  official: "Official stores",
  keyshop: "Key resellers",
  tracker: "Price trackers",
} as const;

export function GameDetail({ id, currency, onClose, onTag, onOpen, onDev }: Props) {
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
          !error && <p className="muted loading-line">Fetching the game…</p>
        ) : (
          <>
            {game.image && <img className="hero" src={game.image} alt="" />}
            <div className="detail-title">
              <h2>{game.name}</h2>
              <SaveButton id={game.id} large />
            </div>
            <p className="detail-facts muted">
              <span>{formatDate(game.releaseDate, game.comingSoon)}</span>
              {game.developers.map((d) => (
                <button key={d} className="dev-link" title={`More by ${d}`} onClick={() => onDev(d)}>
                  {d}
                </button>
              ))}
              {game.publishers.length > 0 && game.publishers.join() !== game.developers.join() && (
                <span>Published by {game.publishers.join(", ")}</span>
              )}
            </p>
            {game.description && <p className="detail-description">{game.description}</p>}
            <MediaGallery id={game.id} storeUrl={game.stores.find((s) => s.store === "steam")?.url ?? null} />
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

            <div className={`power-panel ${summary.powerKnown ? "" : "guess"}`}>
              <div className="power-head">
                <Meter level={summary.power} />
                <strong>{POWER_BY_LEVEL.get(summary.power)!.label} on hardware</strong>
                <span>{POWER_BY_LEVEL.get(summary.power)!.hint}</span>
              </div>
              {detail.specs && (detail.specs.ram || detail.specs.gpuText || detail.specs.disk) && (
                <p className="small">
                  The store asks for at least:{" "}
                  {[
                    detail.specs.ram && `${detail.specs.ram} GB memory`,
                    detail.specs.gpuText,
                    detail.specs.disk && `${detail.specs.disk} GB disk`,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {detail.specs.recGpuText && `. It recommends: ${detail.specs.recGpuText}`}
                </p>
              )}
              <p className="muted small">
                {summary.powerKnown
                  ? "Worked out from the store's minimum and recommended requirements."
                  : detail.specs
                    ? "The store's requirements don't name a graphics card, so this is an estimate from the game's tags, age and price."
                    : "An estimate from the game's tags, age and price. The store's requirements haven't been read yet."}
              </p>
            </div>

            {(game.peakPlayers || game.owners) && (
              <p className="detail-facts muted small">
                {game.peakPlayers ? <span>{game.peakPlayers.toLocaleString()} playing at yesterday's peak</span> : null}
                {game.owners ? <span>{game.owners.replace(" .. ", "–")} owners (estimate)</span> : null}
              </p>
            )}

            {detail.features.length > 0 && (
              <div className="detail-features">
                {(Object.keys(FEATURE_GROUPS) as FeatureGroup[]).map((group) => {
                  const items = FEATURES.filter((f) => f.group === group && detail.features.includes(f.key));
                  if (!items.length) return null;
                  return (
                    <div key={group} className="feature-group">
                      <div className="muted small">{FEATURE_GROUPS[group]}</div>
                      <div className="badges">
                        {items.map((f) => (
                          <span key={f.key} className="badge">
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {detail.languages.length > 0 && (
              <p className="small languages">
                <span className="muted">Languages: </span>
                {detail.languages
                  .map((l) => `${LANGUAGE_BY_CODE.get(l.code)?.name ?? l.code}${l.audio ? "*" : ""}`)
                  .join(", ")}
                <span className="muted"> (* also voiced)</span>
              </p>
            )}

            <h3>Where to buy</h3>
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
                        {s.discountPct > 0 && saleEnds(s.discountEnds) && (
                          <span className="muted small">{saleEnds(s.discountEnds)} </span>
                        )}
                        {s.discountPct > 0 && <span className="discount">−{s.discountPct}%</span>}{" "}
                        {s.free ? "Free" : formatPrice(s.price, currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <h3>Other shops</h3>
            {!prices ? (
              <p className="muted loading-line">Asking the other shops…</p>
            ) : (
              <div className="receipt">
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
                  <p className="receipt-total">
                    <span>Lowest it has ever been</span>
                    <strong>{formatPrice(prices.historicLow, prices.currency)}</strong>
                  </p>
                )}
                {prices.offers.length > 0 && <p className="muted small">Live prices via CheapShark, in {prices.currency}.</p>}
                {(["official", "keyshop", "tracker"] as const).map((kind) => {
                  const links = prices.links.filter((l) => l.kind === kind);
                  if (!links.length) return null;
                  return (
                    <div key={kind} className="link-group">
                      <div className="muted small">
                        {KIND_LABELS[kind]}
                        {kind === "keyshop" && ". Grey-market keys: often cheaper, but the developer may not get paid."}
                      </div>
                      {links.map((l) => (
                        <a key={l.shop} className="shop-link" href={l.url} target="_blank" rel="noreferrer">
                          {l.shop}
                        </a>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {similar && similar.length > 0 && (
              <>
                <h3>If you like this one</h3>
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
