import { useEffect, useMemo, useState } from "react";
import type { LibraryGame, LibraryResponse } from "../../shared/types.ts";
import { api } from "../api.ts";
import { formatCount, formatPrice } from "../format.ts";
import { profileBlurb, profileHandle } from "../../shared/wrapped.ts";
import { ChartCard, Columns, HBars, TierBar } from "./Charts.tsx";
import { Compare } from "./Compare.tsx";
import { ShareButton } from "./ShareButton.tsx";
import { Wrapped } from "./Wrapped.tsx";
import { track } from "../track.ts";
import { signInFailed, SteamSignIn } from "./SteamSignIn.tsx";

const PROFILE_KEY = "game-search:steam-profile";
const PAGE = 60;

const SORTS = {
  value: "Most valuable today",
  played: "Most played",
  perHour: "Cheapest per hour",
  perHourWorst: "Priciest per hour",
  unplayed: "Never played first",
  name: "Name",
} as const;
type Sort = keyof typeof SORTS;

const hours = (minutes: number) => minutes / 60;
const formatHours = (minutes: number, zeroAsHours = false) =>
  minutes === 0 ? (zeroAsHours ? "0 h" : "never played") : minutes < 60 ? `${minutes} min` : `${formatCount(Math.round(hours(minutes)))} h`;
const hoursLabel = (minutes: number) => formatHours(minutes, true);
/** Today's price per hour played; only meaningful after an hour of play. */
const perHour = (g: LibraryGame) => (g.priceNow !== null && g.priceNow > 0 && g.playtimeMinutes >= 60 ? g.priceNow / hours(g.playtimeMinutes) : null);
const steamHeader = (appId: number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;

function sorter(sort: Sort): (a: LibraryGame, b: LibraryGame) => number {
  const last = (x: number | null, y: number | null, dir: 1 | -1) => (x === null ? (y === null ? 0 : 1) : y === null ? -1 : (x - y) * dir);
  switch (sort) {
    case "value":
      return (a, b) => last(a.priceNow, b.priceNow, -1);
    case "played":
      return (a, b) => b.playtimeMinutes - a.playtimeMinutes;
    case "perHour":
      return (a, b) => last(perHour(a), perHour(b), 1);
    case "perHourWorst":
      return (a, b) => last(perHour(a), perHour(b), -1);
    case "unplayed":
      return (a, b) => Number(a.playtimeMinutes > 0) - Number(b.playtimeMinutes > 0) || last(a.priceNow, b.priceNow, -1);
    case "name":
      return (a, b) => a.name.localeCompare(b.name);
  }
}

function Row({ g, currency, onOpen }: { g: LibraryGame; currency: string; onOpen: (id: string) => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const ph = perHour(g);
  const image = g.image ?? steamHeader(g.appId);
  return (
    <li className={`lib-row ${g.id ? "" : "not-listed"}`}>
      <button className="lib-open" onClick={() => g.id && onOpen(g.id)} disabled={!g.id} title={g.id ? "Open" : "Not in the store any more"}>
        <span className="lib-thumb">
          {!imageFailed ? <img src={image} alt="" loading="lazy" onError={() => setImageFailed(true)} /> : null}
        </span>
        <span className="lib-name">{g.name}</span>
      </button>
      <span className={`lib-hours ${g.playtimeMinutes === 0 ? "unplayed" : ""}`}>{formatHours(g.playtimeMinutes)}</span>
      <span className="lib-price">
        {g.priceNow === null ? (
          <span className="muted">not sold</span>
        ) : g.free ? (
          "Free"
        ) : (
          <>
            {g.discountPct > 0 && <s className="muted">{formatPrice(g.priceFull, currency)}</s>} {formatPrice(g.priceNow, currency)}
          </>
        )}
      </span>
      <span className="lib-per-hour muted">{ph !== null ? `${formatPrice(Math.round(ph), currency)}/h` : ""}</span>
    </li>
  );
}

/**
 * What a Steam library is worth: today's prices and list prices from our catalogue,
 * Steam's playtime, and the cost per hour played. Steam doesn't reveal what anyone
 * paid, so "value" is always at today's prices.
 */
/** Remember a profile as "mine" only when it was entered here or signed in, not when following someone's link. */
function rememberMine(profile: string) {
  try {
    localStorage.setItem(PROFILE_KEY, profile);
  } catch {
    // not remembered; fine
  }
}

export type LibrarySub = { wrapped?: boolean; vs?: string };

export function Library({
  initialProfile,
  wrapped,
  vs,
  onProfile,
  onCanonical,
  onSub,
  onOpen,
}: {
  initialProfile: string;
  wrapped: boolean;
  vs: string | undefined;
  onProfile: (p: string) => void;
  /** The short link for the loaded profile, to replace whatever was typed in the URL. */
  onCanonical: (handle: string) => void;
  onSub: (sub: LibrarySub) => void;
  onOpen: (id: string) => void;
}) {
  // Prefilled with the visitor's own profile, not one they followed a link to.
  const [input, setInput] = useState(() => {
    try {
      return localStorage.getItem(PROFILE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  // The profile this visitor said is theirs (signed in, or typed here).
  const [mine, setMine] = useState(input);
  const remember = (profile: string) => {
    rememberMine(profile);
    setMine(profile);
  };
  const [showForm, setShowForm] = useState(false);
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(() =>
    signInFailed() ? "Steam didn't confirm the sign-in. Try again, or paste your profile link." : null,
  );
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<Sort>("value");
  const [unplayedOnly, setUnplayedOnly] = useState(false);
  const [filter, setFilter] = useState("");
  const [shown, setShown] = useState(PAGE);

  const load = (profile: string) => {
    if (!profile.trim()) return;
    setLoading(true);
    setError(null);
    api.library(profile.trim()).then(
      (d) => {
        setData(d);
        setLoading(false);
        setShown(PAGE);
        // Back from "Sign in with Steam": this one is the visitor's own.
        const params = new URLSearchParams(location.search);
        // A profile typed into the form is kept by its short handle, so it's recognised on its short link.
        const own = params.has("me") || mine.trim() === profile.trim() || [profileHandle(d), d.steamId].includes(mine.trim());
        if (params.has("me")) track("signed-in");
        // "link" is the one that matters for growth: someone opened a profile another person shared.
        track("library-view", { source: params.has("me") ? "signin" : own ? "own" : "link", games: d.totals.games });
        if (params.has("me") || mine.trim() === profile.trim()) remember(profileHandle(d));
        setShowForm(false);
        if (params.has("me")) {
          params.delete("me");
          history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
        }
        if (profileHandle(d) !== profile.trim()) onCanonical(profileHandle(d));
      },
      (e) => {
        setError(String(e.message ?? e));
        setData(null);
        setLoading(false);
      },
    );
  };

  // A short link (/u/<profile>) loads straight away; the switch to the canonical handle doesn't reload.
  useEffect(() => {
    if (!initialProfile) return;
    if (data && (profileHandle(data) === initialProfile || data.steamId === initialProfile)) return;
    load(initialProfile);
  }, [initialProfile]);

  const games = useMemo(() => {
    if (!data) return [];
    const f = filter.trim().toLowerCase();
    return data.games
      .filter((g) => (!unplayedOnly || g.playtimeMinutes === 0) && (!f || g.name.toLowerCase().includes(f)))
      .sort(sorter(sort));
  }, [data, sort, unplayedOnly, filter]);

  const t = data?.totals;
  const cur = data?.currency ?? "USD";
  const saved = t && t.valueFull > t.valueNow ? t.valueFull - t.valueNow : 0;

  const isMine = !!data && [profileHandle(data), data.steamId].some((id) => id.toLowerCase() === mine.trim().toLowerCase());
  const form = (
    <form
        className="steam-import"
        onSubmit={(e) => {
          e.preventDefault();
          // A new profile goes into the URL, which loads it; the same one again just reloads.
          remember(input.trim());
          if (input.trim() === initialProfile) load(input);
          else onProfile(input.trim());
        }}
      >
        <label htmlFor="library-profile">{!data ? "What is your Steam library worth?" : isMine ? "Look up another Steam library" : "What is yours worth?"}</label>
        <div className="signin-row">
          <SteamSignIn next="library" />
          <span className="muted small">or paste a profile link:</span>
        </div>
        <div className="steam-import-row">
          <input
            id="library-profile"
            type="text"
            placeholder="steamcommunity.com/id/yourname, custom URL name or SteamID64"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button className="secondary" disabled={loading || !input.trim()}>
            {loading ? "Counting…" : "Value it"}
          </button>
        </div>
        {error && <p className="error small">{error}</p>}
        <p className="muted small">
          Signing in only tells us your Steam ID, nothing else. The profile's game details must be public. Steam doesn't
          show what anyone paid, so everything is at today's prices.
        </p>
      </form>
  );
  const sub = wrapped ? "wrapped" : vs !== undefined ? "vs" : "profile";
  const handle = data ? profileHandle(data) : "";

  return (
    <div className="library">
      {!data && form}
      {data && (
        <nav className="lib-tabs" aria-label="Profile pages">
          <button className={sub === "profile" ? "active" : ""} onClick={() => onSub({})}>
            Profile
          </button>
          <button className={sub === "wrapped" ? "active" : ""} onClick={() => onSub({ wrapped: true })}>
            Wrapped
          </button>
          <button className={sub === "vs" ? "active" : ""} onClick={() => onSub({ vs: "" })}>
            Compare
          </button>
        </nav>
      )}
      {data && sub === "wrapped" && <Wrapped data={data} />}
      {data && sub === "vs" && <Compare data={data} vs={vs ?? ""} onPick={(other) => onSub({ vs: other })} onOpen={onOpen} />}


      {data && t && sub === "profile" && (
        <>
          <ProfileHeader data={data} />
          <div className="share-row">
            <ShareButton
              what="profile"
              url={`/u/${encodeURIComponent(handle)}`}
              title={profileBlurb(data).title}
              text="What's your Steam library worth?"
              image={`/api/share/u/${encodeURIComponent(handle)}/story.png`}
              imageName={`${handle}-steam.png`}
            />
          </div>
          <div className="lib-tiles">
            <div className="lib-tile">
              <span className="lib-tile-label">Worth today</span>
              <strong>{formatPrice(t.valueNow, cur)}</strong>
              <span className="muted small">
                {formatCount(t.priced)} of {formatCount(t.games)} games priced
              </span>
            </div>
            <div className="lib-tile">
              <span className="lib-tile-label">At full price</span>
              <strong>{formatPrice(t.valueFull, cur)}</strong>
              <span className="muted small">{saved > 0 ? `${formatPrice(saved, cur)} off in today's sales` : "no sales today"}</span>
            </div>
            <div className="lib-tile">
              <span className="lib-tile-label">Played</span>
              <strong>{formatCount(Math.round(hours(t.playtimeMinutes)))} h</strong>
              <span className="muted small">
                {t.valueNow > 0 && t.playtimeMinutes >= 60
                  ? `${formatPrice(Math.round(t.valueNow / hours(t.playtimeMinutes)), cur)} per hour, at today's prices`
                  : `${formatCount(t.games - t.neverPlayed)} games played`}
              </span>
            </div>
            <div className="lib-tile">
              <span className="lib-tile-label">Last two weeks</span>
              <strong>{formatHours(data.insights.recentMinutes, true)}</strong>
              <span className="muted small">
                {data.insights.recent.length ? `${data.insights.recent.length} games played` : "nothing played lately"}
              </span>
            </div>
            <div className="lib-tile shame">
              <span className="lib-tile-label">Never played</span>
              <strong>{formatCount(t.neverPlayed)} games</strong>
              <span className="muted small">worth {formatPrice(t.neverPlayedValue, cur)} today</span>
            </div>
          </div>

          <Insights data={data} onOpen={onOpen} />

          <h2 className="lib-section">Every game</h2>
          <div className="results-bar">
            <input type="search" placeholder="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <label className="check">
              <input type="checkbox" checked={unplayedOnly} onChange={(e) => setUnplayedOnly(e.target.checked)} />
              Never played
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
              {Object.entries(SORTS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <ul className="lib-list">
            <li className="lib-row lib-header muted small" aria-hidden="true">
              <span>Game</span>
              <span>Played</span>
              <span>Today</span>
              <span>Per hour</span>
            </li>
            {games.slice(0, shown).map((g) => (
              <Row key={g.appId} g={g} currency={cur} onOpen={onOpen} />
            ))}
          </ul>
          {games.length > shown && (
            <div className="pager">
              <button onClick={() => setShown((n) => n + PAGE * 2)}>Show more ({formatCount(games.length - shown)} left)</button>
            </div>
          )}
          {!games.length && <p className="muted">No games match.</p>}
        </>
      )}
      {/* On someone else's profile: the invitation to value yours. On your own, just a way to look up another. */}
      {data &&
        (isMine && !showForm ? (
          <p className="lib-yours small">
            <button className="link-button" onClick={() => setShowForm(true)}>
              Look up another profile
            </button>
          </p>
        ) : (
          <div className="lib-yours">{form}</div>
        ))}
    </div>
  );
}

function ProfileHeader({ data }: { data: LibraryResponse }) {
  const p = data.profile;
  const since = p.memberSince ? new Date(p.memberSince * 1000) : null;
  const years = since ? Math.floor((Date.now() - since.getTime()) / (365.25 * 86_400_000)) : null;
  const facts = [
    p.level !== null ? `Level ${p.level}` : null,
    since ? `Member since ${since.getFullYear()}${years ? ` (${years} ${years === 1 ? "year" : "years"})` : ""}` : null,
    p.badges !== null ? `${formatCount(p.badges)} badges` : null,
    p.friends !== null ? `${formatCount(p.friends)} friends` : null,
    p.country,
  ].filter(Boolean);
  return (
    <div className="lib-head">
      {p.avatar && <img className="lib-avatar" src={p.avatar} alt="" />}
      <div>
        <h2>
          {p.profileUrl ? (
            <a href={p.profileUrl} target="_blank" rel="noreferrer">
              {p.name ?? "Steam profile"}
            </a>
          ) : (
            (p.name ?? "Steam profile")
          )}
        </h2>
        {facts.length > 0 && <p className="lib-facts muted">{facts.join(" · ")}</p>}
      </div>
    </div>
  );
}

/** The charts and lists about how the library is played. */
function Insights({ data, onOpen }: { data: LibraryResponse; onOpen: (id: string) => void }) {
  const i = data.insights;
  const cur = data.currency;
  const total = data.totals.playtimeMinutes;
  if (!total && !i.unplayedGems.length) return null;
  const byAppId = new Map(data.games.map((g) => [g.appId, g]));
  const open = (appId: string | number) => {
    const id = byAppId.get(Number(appId))?.id;
    if (id) onOpen(id);
  };
  const share = (m: number) => (total ? `${Math.round((m / total) * 100)}% of all your hours` : "");
  const firstYear = i.byYear[0]?.year;
  const lastYear = i.byYear.at(-1)?.year;

  return (
    <section className="insights" aria-label="How this library is played">
      {i.topGames.length > 0 && (
        <ChartCard
          title="Where the hours went"
          subtitle="Most-played games"
          table={{ head: ["Game", "Hours"], rows: i.topGames.map((g) => [g.name, Math.round(hours(g.minutes))]) }}
        >
          <HBars
            rows={i.topGames.map((g) => ({ key: g.appId, label: g.name, value: g.minutes }))}
            format={hoursLabel}
            detail={(k) => share(byAppId.get(Number(k))?.playtimeMinutes ?? 0)}
            onSelect={open}
          />
        </ChartCard>
      )}

      {i.byTag.length > 0 && (
        <ChartCard
          title="What you play"
          subtitle="Hours in games with each tag (a game's hours count for its top three tags)"
          table={{ head: ["Tag", "Hours", "Games"], rows: i.byTag.map((t) => [t.tag, Math.round(hours(t.minutes)), t.games]) }}
        >
          <HBars
            rows={i.byTag.map((t) => ({ key: t.tag, label: t.tag, value: t.minutes }))}
            format={hoursLabel}
            detail={(k) => {
              const n = i.byTag.find((t) => t.tag === k)?.games ?? 0;
              return `${n} ${n === 1 ? "game" : "games"}`;
            }}
          />
        </ChartCard>
      )}

      {i.byYear.length > 1 && (
        <ChartCard
          wide
          title="Your library by release year"
          subtitle={`Games owned, by the year they came out (${firstYear}–${lastYear})`}
          table={{
            head: ["Year", "Games", "Never played", "Hours"],
            rows: i.byYear.filter((y) => y.games).map((y) => [y.year, y.games, y.unplayed, Math.round(hours(y.minutes))]),
          }}
        >
          <Columns
            columns={i.byYear.map((y) => ({ key: y.year, label: String(y.year), value: y.games }))}
            format={(v) => formatCount(Math.round(v))}
            unit=" games"
            detail={(year) => {
              const y = i.byYear.find((x) => x.year === year)!;
              return `${formatCount(y.unplayed)} never played, ${hoursLabel(y.minutes)} played`;
            }}
          />
        </ChartCard>
      )}

      {total > 0 && (
        <ChartCard
          title="How spread out your playtime is"
          subtitle={i.concentration.top1 >= 0.5 ? "One game has more than half of all your hours" : "Share of all hours played"}
        >
          <TierBar
            tiers={[
              { label: `in ${i.topGames[0]?.name ?? "the top game"}`, share: i.concentration.top1 },
              { label: "in the next 9 games", share: i.concentration.next9 },
              { label: "in everything else", share: i.concentration.rest },
            ]}
          />
          <dl className="lib-facts-grid">
            {i.avgReviewPct !== null && (
              <>
                <dt>Taste</dt>
                <dd>What you play is rated {i.avgReviewPct}% positive on average (weighted by hours)</dd>
              </>
            )}
            <dt>Together</dt>
            <dd>
              {Math.round((i.multiplayerMinutes / total) * 100)}% of your hours are in games with multiplayer
            </dd>
          </dl>
        </ChartCard>
      )}

      {i.recent.length > 0 && (
        <ChartCard title="Lately" subtitle="Played in the last two weeks">
          <HBars rows={i.recent.map((g) => ({ key: g.appId, label: g.name, value: g.minutes }))} format={hoursLabel} onSelect={open} />
        </ChartCard>
      )}

      {i.unplayedGems.length > 0 && (
        <ChartCard title="Gems on your shelf" subtitle="Best-rated games you own but never started">
          <ol className="gems">
            {i.unplayedGems.map((g) => (
              <li key={g.appId}>
                <button className="dev-link" onClick={() => open(g.appId)} disabled={!g.id}>
                  {g.name}
                </button>
                <span className="muted">
                  {g.reviewPct}% positive{g.priceNow ? ` · ${formatPrice(g.priceNow, cur)} today` : ""}
                </span>
              </li>
            ))}
          </ol>
        </ChartCard>
      )}
    </section>
  );
}
