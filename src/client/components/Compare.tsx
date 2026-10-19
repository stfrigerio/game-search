import { useEffect, useMemo, useState } from "react";
import type { CompareResponse, LibraryResponse, Recommendation, SharedGame, SteamFriend } from "../../shared/types.ts";
import { profileHandle } from "../../shared/wrapped.ts";
import { api } from "../api.ts";
import { formatCount, formatPrice } from "../format.ts";
import { ShareButton } from "./ShareButton.tsx";

const hours = (m: number) => (m === 0 ? "—" : m < 60 ? `${m} min` : `${formatCount(Math.round(m / 60))} h`);
const steamHeader = (appId: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

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
      <form
        className="steam-import"
        onSubmit={(e) => {
          e.preventDefault();
          if (other.trim()) onPick(other.trim());
        }}
      >
        <label htmlFor="compare-other">Compare with anyone</label>
        <div className="steam-import-row">
          <input
            id="compare-other"
            type="text"
            placeholder="Their profile link, custom URL name or SteamID64"
            value={other}
            onChange={(e) => setOther(e.target.value)}
          />
          <button className="secondary" disabled={!other.trim()}>
            Compare
          </button>
        </div>
      </form>
      <h2 className="lib-section">Or pick a friend</h2>
      {friends === null ? (
        <p className="muted loading-line">Asking Steam for the friend list…</p>
      ) : !friends.length ? (
        <p className="muted">The friend list is private or empty, so paste a profile above instead.</p>
      ) : (
        <>
          {friends.length > 12 && (
            <input className="friend-filter" type="search" placeholder="Find a friend" value={filter} onChange={(e) => setFilter(e.target.value)} />
          )}
          <ul className="friends">
            {shown.map((f) => (
              <li key={f.steamId}>
                <button onClick={() => onPick(f.steamId)}>
                  {f.avatar ? <img src={f.avatar} alt="" loading="lazy" /> : <span className="friend-blank" />}
                  <span>{f.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function GameTile({ g, children, onOpen }: { g: { appId: number; id: string | null; name: string; image: string | null }; children: React.ReactNode; onOpen: (id: string) => void }) {
  return (
    <li className="cmp-game">
      <button onClick={() => g.id && onOpen(g.id)} disabled={!g.id}>
        <img src={g.image ?? steamHeader(g.appId)} alt="" loading="lazy" />
        <strong>{g.name}</strong>
        <span className="muted small">{children}</span>
      </button>
    </li>
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
    api.compare(me, vs).then((c) => live && setCmp(c), (e) => live && setError(String(e.message ?? e)));
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
  const side = (s: CompareResponse["a"], align: string) => (
    <div className={`cmp-side ${align}`}>
      {s.profile.avatar && <img src={s.profile.avatar} alt="" />}
      <strong>{s.profile.name ?? "Steam profile"}</strong>
      <span className="sticker">{s.persona.title}</span>
      <span className="muted small">
        {formatCount(s.totals.games)} games · {hours(s.totals.playtimeMinutes)} · {formatPrice(s.totals.valueNow, currency)}
      </span>
    </div>
  );
  const recs = (who: string, to: string, list: Recommendation[]) =>
    list.length > 0 && (
      <>
        <h2 className="lib-section">
          {who} thinks {to} should play
        </h2>
        <ul className="cmp-games">
          {list.map((g) => (
            <GameTile key={g.appId} g={g} onOpen={onOpen}>
              {who}: {hours(g.minutes)} · {g.owned ? `${to} owns it, never played` : g.priceNow === null ? "not sold" : formatPrice(g.priceNow, currency)}
            </GameTile>
          ))}
        </ul>
      </>
    );
  const both = (g: SharedGame) => `${nameA}: ${hours(g.minutesA)} · ${nameB}: ${hours(g.minutesB)}`;

  return (
    <div className="compare">
      <div className="cmp-head">
        {side(a, "left")}
        <span className="cmp-vs" aria-hidden="true">
          vs
        </span>
        {side(b, "right")}
      </div>
      <div className="lib-tiles">
        <div className="lib-tile">
          <span className="lib-tile-label">In common</span>
          <strong>{formatCount(cmp.common)} games</strong>
        </div>
        <div className="lib-tile">
          <span className="lib-tile-label">Taste match</span>
          <strong>{Math.round(cmp.tasteMatch * 100)}%</strong>
          <span className="muted small">how alike the hours split across tags</span>
        </div>
        <div className="lib-tile">
          <span className="lib-tile-label">Play together</span>
          <strong>{formatCount(cmp.together.length)} games</strong>
          <span className="muted small">both own it and it plays online</span>
        </div>
      </div>
      <div className="share-row">
        <ShareButton
          url={`/u/${encodeURIComponent(a.handle)}/vs/${encodeURIComponent(b.handle)}`}
          title={`${nameA} vs ${nameB} on Steam`}
          text={`${Math.round(cmp.tasteMatch * 100)}% taste match, ${cmp.common} games in common.`}
          image={`/api/share/vs/${encodeURIComponent(a.handle)}/${encodeURIComponent(b.handle)}/card.png`}
          imageName="steam-vs.png"
        />
        <button className="secondary" onClick={() => onPick("")}>
          Compare with someone else
        </button>
      </div>

      {cmp.together.length > 0 && (
        <>
          <h2 className="lib-section">Play together tonight</h2>
          <p className="muted small">You both own these and they have online co-op or versus.</p>
          <ul className="cmp-games">
            {cmp.together.map((g) => (
              <GameTile key={g.appId} g={g} onOpen={onOpen}>
                {g.onlineCoop ? "Online co-op" : "Online versus"}
                {g.reviewPct !== null ? ` · ${g.reviewPct}% positive` : ""}
              </GameTile>
            ))}
          </ul>
        </>
      )}
      {cmp.bothPlayed.length > 0 && (
        <>
          <h2 className="lib-section">You both played</h2>
          <ul className="cmp-games">
            {cmp.bothPlayed.map((g) => (
              <GameTile key={g.appId} g={g} onOpen={onOpen}>
                {both(g)}
              </GameTile>
            ))}
          </ul>
        </>
      )}
      {recs(nameA, nameB, cmp.aRecommends)}
      {recs(nameB, nameA, cmp.bRecommends)}
    </div>
  );
}
