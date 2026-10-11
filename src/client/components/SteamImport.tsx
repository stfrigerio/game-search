import { useState } from "react";
import { api } from "../api.ts";
import { useSavedList } from "../savedList.ts";

const PROFILE_KEY = "game-search:steam-profile";

export function SteamImport() {
  const list = useSavedList();
  const [profile, setProfile] = useState(() => {
    try {
      return localStorage.getItem(PROFILE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async () => {
    if (!profile.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.steamWishlist(profile);
      const added = list.addMany(res.ids);
      try {
        localStorage.setItem(PROFILE_KEY, profile.trim());
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

  return (
    <form
      className="steam-import"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <label htmlFor="steam-profile">Import your Steam wishlist</label>
      <div className="steam-import-row">
        <input
          id="steam-profile"
          type="text"
          placeholder="steamcommunity.com/id/yourname, custom URL name or SteamID64"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        />
        <button className="primary" disabled={busy || !profile.trim()}>
          {busy ? "Importing…" : "Import"}
        </button>
      </div>
      {message && <p className={message.error ? "error small" : "muted small"}>{message.text}</p>}
      <p className="muted small">Your wishlist must be public. Re-import any time to pick up new games.</p>
    </form>
  );
}
