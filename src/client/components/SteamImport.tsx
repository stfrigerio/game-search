import { useEffect, useState } from "react";
import { api } from "../api.ts";
import { useSavedList } from "../savedList.ts";
import { signInFailed, SteamSignIn } from "./SteamSignIn.tsx";

const PROFILE_KEY = "game-search:steam-profile";

/** `steamId`: a SteamID just verified by "Sign in with Steam"; imported straight away. */
export function SteamImport({ steamId }: { steamId?: string | null }) {
  const list = useSavedList();
  const [profile, setProfile] = useState(() => {
    try {
      return localStorage.getItem(PROFILE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(() =>
    signInFailed() ? { text: "Steam didn't confirm the sign-in. Try again, or paste your profile link.", error: true } : null,
  );

  const run = async (value = profile) => {
    if (!value.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.steamWishlist(value);
      const added = list.addMany(res.ids);
      try {
        localStorage.setItem(PROFILE_KEY, value.trim());
      } catch {
        // not persisted; fine
      }
      setMessage({
        text:
          `Imported ${res.ids.length} of ${res.total} wishlist items (${added} new).` +
          (res.ids.length < res.total ? " The rest are DLC, soundtracks or delisted games." : ""),
        error: false,
      });
    } catch (err) {
      setMessage({ text: (err as Error).message, error: true });
    } finally {
      setBusy(false);
    }
  };

  // Back from Steam's sign-in: import once, then drop the id from the address bar.
  useEffect(() => {
    if (!steamId) return;
    setProfile(steamId);
    void run(steamId);
    const params = new URLSearchParams(location.search);
    params.delete("steam");
    history.replaceState(history.state, "", `${location.pathname}?${params}`);
  }, [steamId]);

  return (
    <form
      className="steam-import"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <label htmlFor="steam-profile">Import your Steam wishlist</label>
      <div className="signin-row">
        <SteamSignIn next="list" label={busy ? "Importing…" : "Sign in with Steam"} />
        <span className="muted small">or paste a profile link:</span>
      </div>
      <div className="steam-import-row">
        <input
          id="steam-profile"
          type="text"
          placeholder="steamcommunity.com/id/yourname, custom URL name or SteamID64"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        />
        <button className="secondary" disabled={busy || !profile.trim()}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      {message && <p className={message.error ? "error small" : "muted small"}>{message.text}</p>}
      <p className="muted small">
        Signing in only tells us your Steam ID; your wishlist must be public. Re-import any time to pick up new games.
      </p>
    </form>
  );
}
