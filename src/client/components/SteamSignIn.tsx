import { track } from "../track.ts";

/**
 * One-click "Sign in with Steam": Steam's own login page (OpenID) sends the visitor
 * back with their verified SteamID, so nobody has to find or paste an id. We store
 * nothing; the id lands in the page's URL.
 */
export function SteamSignIn({ next, label = "Sign in with Steam" }: { next: "library" | "list"; label?: string }) {
  return (
    <a className="primary steam-signin" href={`/api/auth/steam?next=${next}`} onClick={() => track("signin-click", { next })}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <circle cx="15.5" cy="9" r="3.2" fill="var(--yellow)" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="8.5" cy="15" r="2.2" fill="var(--yellow)" stroke="currentColor" strokeWidth="1.2" />
        <path d="M10.2 14 13.6 10.6" stroke="var(--yellow)" strokeWidth="1.6" />
      </svg>
      {label}
    </a>
  );
}

/** True when Steam sent the visitor back without a valid sign-in. */
export const signInFailed = () => new URLSearchParams(location.search).get("signin") === "failed";
