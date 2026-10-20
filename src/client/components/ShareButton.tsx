import { useState } from "react";
import { track } from "../track.ts";

/**
 * Share a link: the phone's share sheet where there is one, else copy it. With an
 * image, a second button shares or saves the picture itself (for stories and chats
 * that want a picture, not a link).
 */
export function ShareButton({
  url,
  title,
  text,
  image,
  imageName = "game-search.png",
  label = "Share",
  what,
}: {
  url: string;
  title: string;
  text?: string;
  /** Path of a PNG to offer as a picture. */
  image?: string;
  imageName?: string;
  label?: string;
  /** For analytics: which kind of page is being shared. */
  what: "profile" | "wrapped" | "compare" | "game";
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2500);
  };

  const shareLink = async () => {
    const full = new URL(url, location.origin).href;
    if (navigator.share) {
      try {
        await navigator.share({ url: full, title, text });
        track("share", { what, how: "sheet" });
        return;
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(full);
      track("share", { what, how: "copy" });
      flash("Link copied");
    } catch {
      prompt("Copy this link:", full);
    }
  };

  const shareImage = async () => {
    if (!image) return;
    setBusy(true);
    try {
      const blob = await fetch(image).then((r) => {
        if (!r.ok || r.headers.get("content-type") !== "image/png") throw new Error("no image");
        return r.blob();
      });
      const file = new File([blob], imageName, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title, text: `${text ?? title} ${new URL(url, location.origin).href}` });
          track("save-image", { what, how: "sheet" });
          return;
        } catch (e) {
          if ((e as Error).name === "AbortError") return;
        }
      }
      // Desktop: download it.
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = imageName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      track("save-image", { what, how: "download" });
      flash("Image saved");
    } catch {
      flash("Couldn't make the image, try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="share">
      <button type="button" className="primary" onClick={shareLink}>
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
          <path d="M8 1v9M4.5 4.5 8 1l3.5 3.5M3 8v6h10V8" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        {label}
      </button>
      {image && (
        <button type="button" className="secondary" onClick={shareImage} disabled={busy}>
          {busy ? "Drawing…" : "Save image"}
        </button>
      )}
      <span className="share-note small" role="status">
        {note}
      </span>
    </span>
  );
}
