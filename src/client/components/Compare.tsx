import { useEffect, useMemo, useState } from "react";
import type { CompareResponse, CompareSide, LibraryResponse, Recommendation, SharedGame, SteamFriend } from "../../shared/types.ts";
import { profileHandle } from "../../shared/wrapped.ts";
import { api } from "../api.ts";
import { formatCount, formatPrice } from "../format.ts";
import { ChartCard, SERIES } from "./Charts.tsx";
import { ShareButton } from "./ShareButton.tsx";
import { track } from "../track.ts";

const hours = (m: number) => (m === 0 ? "0 h" : m < 60 ? `${m} min` : `${formatCount(Math.round(m / 60))} h`);
const steamHeader = (appId: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
const SHOWN = 6;

/** Pick a friend (or paste any profile) to compare with. */
function FriendPicker({ profile, onPick }: { profile: string; onPick: (handle: string) => void }) {
  const [friends, setFriends] = useState<SteamFriend[] | null>(null);
  const [filter, setFilter] = useState("");
  const [other, setOther] = useState("");
  useEffect(() => {
    let live = true;
    api.friends(profile).then((f) => live && setFriends(f), () => live && setFriends([]));
    return () => {
      live = false;
    };
  }, [profile]);
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (friends ?? []).filter((x) => !f || x.name.toLowerCase().includes(f));
  }, [friends, filter]);

  return (
    <div className="compare-pick">
      <h2 className="lib-section">Compare with a friend</h2>
      {friends === null ? (
        <p className="muted loading-line">Asking Steam for the friend list…</p>
      ) : friends.length > 0 ? (
        <div className="friend-box">
          <input
            className="friend-filter"
            type="search"
            placeholder={`Find one of ${formatCount(friends.length)} friends`}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Find a friend"
          />
          <ul className="friends">
            {shown.map((f) => (
              <li key={f.steamId}>
                <button
                  onClick={() => {
                    track("compare-pick", { from: "friends" });
                    onPick(f.steamId);
                  }}
                >
                  {f.avatar ? <img src={f.avatar} alt="" loading="lazy" /> : <span className="friend-blank" />}
                  <span>{f.name}</span>
                </button>
              </li>
            ))}
            {!shown.length && <li className="muted small friends-none">No friend called that.</li>}
          </ul>
        </div>
      ) : (
        <p className="muted">The friend list is private or empty. Paste someone's profile instead:</p>
      )}
      <form
        className="compare-other"
        onSubmit={(e) => {
          e.preventDefault();
          if (!other.trim()) return;
          track("compare-pick", { from: "pasted" });
          onPick(other.trim());
        }}
      >
        <input
          type="text"
          placeholder="Or paste anyone's profile link or SteamID64"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          aria-label="Profile to compare with"
        />
        <button className="secondary" disabled={!other.trim()}>
          Compare
        </button>
      </form>
    </div>
  );
}

/** A game as one line: small picture, name, a detail. */
function GameRow({ g, detail, onOpen }: { g: { appId: number; id: string | null; name: string; image: string | null }; detail: string; onOpen: (id: string) => void }) {
  return (
    <li>
      <button className="cmp-row" onClick={() => g.id && onOpen(g.id)} disabled={!g.id}>
        <img src={g.image ?? steamHeader(g.appId)} alt="" loading="lazy" />
        <span className="cmp-row-text">
          <strong>{g.name}</strong>
          <span className="muted small">{detail}</span>
        </span>
      </button>
    </li>
  );
}

function GameList<T extends { appId: number }>({ items, render }: { items: T[]; render: (item: T) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  return (
    <>
      <ul className="cmp-list">{(all ? items : items.slice(0, SHOWN)).map(render)}</ul>
      {items.length > SHOWN && (
        <button className="link-button small" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

/**
 * Hours in the games both have played, back to back: one side's bars grow left, the
 * other's right, on one shared scale. Which side is whose is said by position and the
 * names above, so both use the same colour; every value is printed at its bar.
 */
function Butterfly({ games, nameA, nameB, onOpen }: { games: SharedGame[]; nameA: string; nameB: string; onOpen: (id: string) => void }) {
  const max = Math.max(1, ...games.flatMap((g) => [g.minutesA, g.minutesB]));
  const pct = (m: number) => `${(m / max) * 100}%`;
  return (
    <div className="butterfly">
      <div className="bf-head muted small" aria-hidden="true">
        <span>{nameA}</span>
        <span />
        <span>{nameB}</span>
      </div>
      {games.map((g) => (
        <div key={g.appId} className="bf-row">
          <div className="bf-side left" aria-label={`${nameA}: ${hours(g.minutesA)}`}>
            <span className="bf-value">{hours(g.minutesA)}</span>
            <span className="bf-bar" style={{ width: pct(g.minutesA), background: SERIES }} />
          </div>
          <button className="bf-name" onClick={() => g.id && onOpen(g.id)} disabled={!g.id} title={g.name}>
            {g.name}
          </button>
          <div className="bf-side right" aria-label={`${nameB}: ${hours(g.minutesB)}`}>
            <span className="bf-bar" style={{ width: pct(g.minutesB), background: SERIES }} />
            <span className="bf-value">{hours(g.minutesB)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Two libraries side by side: what they share, what to play together, what to try next. */
export function Compare({
  data,
  vs,
  onPick,
  onOpen,
}: {
  data: LibraryResponse;
  vs: string;
  onPick: (handle: string) => void;
  onOpen: (id: string) => void;
}) {
  const me = profileHandle(data);
  const [cmp, setCmp] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vs) return;
    setCmp(null);
    setError(null);
    let live = true;
    api.compare(me, vs).then((c) => {
      if (!live) return;
      setCmp(c);
      track("compare-view", { common: c.common, together: c.together.length });
    }, (e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [me, vs]);

  if (!vs) return <FriendPicker profile={data.steamId} onPick={onPick} />;
  if (error)
    return (
      <div>
        <p className="error">{error}</p>
        <button className="secondary" onClick={() => onPick("")}>
          Pick someone else
        </button>
      </div>
    );
  if (!cmp) return <p className="muted loading-line">Putting the two libraries side by side…</p>;

  const { a, b, currency } = cmp;
  const nameA = a.profile.name ?? "You";
  const nameB = b.profile.name ?? "Them";
  const person = (s: CompareSide) => (
    <div className="cmp-person">
      {s.profile.avatar ? <img src={s.profile.avatar} alt="" /> : <span className="friend-blank" />}
      <strong>{s.profile.name ?? "Steam profile"}</strong>
      <span className="sticker">{s.persona.title}</span>
    </div>
  );
  // Each fact with both values; the bigger one is marked (not judged: more isn't always better).
  const facts: [string, number, number, (n: number) => string][] = [
    ["Games", a.totals.games, b.totals.games, formatCount],
    ["Hours played", a.totals.playtimeMinutes, b.totals.playtimeMinutes, hours],
    ["Worth today", a.totals.valueNow, b.totals.valueNow, (n) => formatPrice(n, currency)],
    ["Never played", a.totals.neverPlayed, b.totals.neverPlayed, formatCount],
  ];
  const recs = (list: Recommendation[], who: string, to: string) => (
    <section className="cmp-col">
      <h3>
        {to} should try
      </h3>
      {list.length ? (
        <GameList
          items={list}
          render={(g) => (
            <GameRow
              key={g.appId}
              g={g}
              onOpen={onOpen}
              detail={`${who} played ${hours(g.minutes)} · ${g.owned ? `${to} owns it already` : g.priceNow === null ? "not sold" : formatPrice(g.priceNow, currency)}`}
            />
          )}
        />
      ) : (
        <p className="muted small">Nothing {who} plays a lot that {to} hasn't.</p>
      )}
    </section>
  );

  return (
    <div className="compare">
      <div className="cmp-card">
        <div className="cmp-head">
          {person(a)}
          <span className="cmp-vs" aria-hidden="true">
            vs
          </span>
          {person(b)}
        </div>
        <table className="cmp-facts">
          <tbody>
            {facts.map(([label, x, y, fmt]) => (
              <tr key={label}>
                <td>
                  <span className={x > y ? "more" : ""}>{fmt(x)}</span>
                </td>
                <th scope="row">{label}</th>
                <td>
                  <span className={y > x ? "more" : ""}>{fmt(y)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="cmp-summary">
          <strong>{Math.round(cmp.tasteMatch * 100)}% taste match</strong>
          <span>{formatCount(cmp.common)} games in common</span>
          <span>{formatCount(cmp.together.length)} to play together online</span>
        </p>
        <div className="share-row">
          <ShareButton
            what="compare"
            url={`/u/${encodeURIComponent(a.handle)}/vs/${encodeURIComponent(b.handle)}`}
            title={`${nameA} vs ${nameB} on Steam`}
            text={`${Math.round(cmp.tasteMatch * 100)}% taste match, ${cmp.common} games in common.`}
            image={`/api/share/vs/${encodeURIComponent(a.handle)}/${encodeURIComponent(b.handle)}/card.png`}
            imageName="steam-vs.png"
          />
          <button className="link-button" onClick={() => onPick("")}>
            Compare with someone else
          </button>
        </div>
      </div>

      {cmp.together.length > 0 && (
        <section>
          <h2 className="lib-section">Play together tonight</h2>
          <p className="muted small cmp-note">You both own these, and they have online co-op or versus.</p>
          <GameList
            items={cmp.together}
            render={(g) => (
              <GameRow
                key={g.appId}
                g={g}
                onOpen={onOpen}
                detail={`${g.onlineCoop ? "Online co-op" : "Online versus"}${g.reviewPct !== null ? ` · ${g.reviewPct}% positive` : ""}`}
              />
            )}
          />
        </section>
      )}

      {cmp.bothPlayed.length > 0 && (
        <ChartCard
          wide
          title="Where your hours meet"
          subtitle="Games you have both played, and how long each of you has"
          table={{ head: ["Game", nameA, nameB], rows: cmp.bothPlayed.map((g) => [g.name, hours(g.minutesA), hours(g.minutesB)]) }}
        >
          <Butterfly games={cmp.bothPlayed.slice(0, 8)} nameA={nameA} nameB={nameB} onOpen={onOpen} />
        </ChartCard>
      )}

      <div className="cmp-cols">
        {recs(cmp.aRecommends, nameA, nameB)}
        {recs(cmp.bRecommends, nameB, nameA)}
      </div>
    </div>
  );
}
