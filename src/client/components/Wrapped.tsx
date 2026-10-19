import { useEffect, useMemo, useState } from "react";
import type { LibraryResponse } from "../../shared/types.ts";
import { profileHandle, wrappedSlides } from "../../shared/wrapped.ts";
import { ShareButton } from "./ShareButton.tsx";

/**
 * The library as a story: one picture per slide, drawn by the server so each one
 * can be saved and posted as it is. Tap the right side (or press →) for the next.
 */
export function Wrapped({ data }: { data: LibraryResponse }) {
  const slides = useMemo(() => wrappedSlides(data), [data]);
  const handle = profileHandle(data);
  const [at, setAt] = useState(0);
  const slide = slides[Math.min(at, slides.length - 1)];
  const src = (key: string) => `/api/share/u/${encodeURIComponent(handle)}/wrapped-${key}.png`;
  const go = (d: number) => setAt((i) => Math.max(0, Math.min(slides.length - 1, i + d)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  // Draw the next slide while this one is read.
  useEffect(() => {
    const next = slides[at + 1];
    if (next) new Image().src = src(next.key);
  }, [at, slides]);

  const alt = [slide.eyebrow, slide.big, slide.title, ...slide.lines].map((x) => x.replace(/[.:]$/, "")).join(". ");
  return (
    <section className="wrapped" aria-label="Your library, wrapped">
      <div className="wrapped-bars" aria-hidden="true">
        {slides.map((s, i) => (
          <span key={s.key} className={i <= at ? "done" : ""} />
        ))}
      </div>
      <div className="wrapped-stage">
        <img key={slide.key} src={src(slide.key)} alt={alt} width={1080} height={1920} />
        <button className="wrapped-tap prev" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous slide" />
        <button className="wrapped-tap next" onClick={() => go(1)} disabled={at === slides.length - 1} aria-label="Next slide" />
      </div>
      <p className="muted small wrapped-count">
        {at + 1} of {slides.length}
      </p>
      <div className="wrapped-actions">
        <ShareButton
          url={`/u/${encodeURIComponent(handle)}/wrapped`}
          title={`${data.profile.name ?? "My"} Steam library, wrapped`}
          text={slide.key === "persona" ? `I'm ${slide.big}. What are you?` : "My Steam library, wrapped."}
          image={src(slide.key)}
          imageName={`wrapped-${slide.key}.png`}
          label="Share Wrapped"
        />
      </div>
    </section>
  );
}
