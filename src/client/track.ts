/*
 * Product events for umami (index.html loads it on the public address only, so
 * nothing is sent in development). No personal data: never a Steam ID or a name,
 * only what kind of thing happened.
 */

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number | boolean>) => void };
  }
}

export type TrackEvent =
  | "signin-click" // pressed "Sign in with Steam"
  | "signed-in" // came back from Steam with a verified id
  | "library-view" // a library loaded; source says how the visitor got there
  | "share" // shared a link (what, how)
  | "save-image" // saved or shared a picture (what)
  | "wrapped-open"
  | "wrapped-finish" // reached the last slide
  | "compare-pick" // chose who to compare with (friend list or pasted)
  | "compare-view";

export function track(event: TrackEvent, data?: Record<string, string | number | boolean>) {
  try {
    window.umami?.track(event, data);
  } catch {
    // analytics never breaks the page
  }
}
