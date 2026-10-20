import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryResponse } from "../../shared/types.ts";
import { profileHandle, wrappedSlides } from "../../shared/wrapped.ts";
import { ShareButton } from "./ShareButton.tsx";
import { track } from "../track.ts";

/**
 * The library as a story: one picture per slide, drawn by the server so each one
 * can be saved and posted as it is. Swipe, tap the right side or press → for the next.
 */
export function Wrapped({ data }: { data: LibraryResponse }) {
  const slides = useMemo(() => wrappedSlides(data), [data]);
  const handle = profileHandle(data);
  const [at, setAt] = useState(0);
  const slide = slides[Math.min(at, slides.length - 1)];
  // Shown plain here; the saved or shared picture carries the site's name and link.
  const src = (key: string, plain = false) => `/api/share/u/${encodeURIComponent(handle)}/wrapped-${key}${plain ? "-plain" : ""}.png`;
  const go = (d: number) => setAt((i) => Math.max(0, Math.min(slides.length - 1, i + d)));

  // Swiping: the slide follows the finger sideways and turns past a threshold. Vertical
  // moves are left to the page (touch-action: pan-y), and the click that ends a swipe
  // is swallowed so it doesn't also count as a tap.
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiped.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s0 = start.current;
    if (!s0 || s0.id !== e.pointerId) return;
    const dx = e.clientX - s0.x;
    if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(e.clientY - s0.y)) return;
    if (!swiped.current) e.currentTarget.setPointerCapture(e.pointerId);
    swiped.current = true;
    // Resist at the first and last slide.
    const edge = (dx > 0 && at === 0) || (dx < 0 && at === slides.length - 1);
    setDrag(edge ? dx / 4 : dx);
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    const s0 = start.current;
    if (!s0 || s0.id !== e.pointerId) return;
    start.current = null;
    const width = e.currentTarget.getBoundingClientRect().width;
    if (swiped.current && Math.abs(drag) > Math.min(60, width * 0.18)) go(drag < 0 ? 1 : -1);
    setDrag(0);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slides.length]);

  useEffect(() => track("wrapped-open"), []);
  useEffect(() => {
    if (at === slides.length - 1 && at > 0) track("wrapped-finish");
  }, [at, slides.length]);

  // Draw the next slide while this one is read.
  useEffect(() => {
    const next = slides[at + 1];
    if (next) new Image().src = src(next.key, true);
  }, [at, slides]);

  const alt = [slide.eyebrow, slide.big, slide.title, ...slide.lines].map((x) => x.replace(/[.:]$/, "")).join(". ");
  return (
    <section className="wrapped" aria-label="Your library, wrapped">
      <div className="wrapped-bars" aria-hidden="true">
        {slides.map((s, i) => (
          <span key={s.key} className={i <= at ? "done" : ""} />
        ))}
      </div>
      <div
        className={`wrapped-stage ${drag ? "dragging" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onClickCapture={(e) => {
          if (!swiped.current) return;
          swiped.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        <img
          key={slide.key}
          src={src(slide.key, true)}
          alt={alt}
          width={1080}
          height={1920}
          draggable={false}
          style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 60}deg)` } : undefined}
        />
        <button className="wrapped-tap prev" onClick={() => go(-1)} disabled={at === 0} aria-label="Previous slide" />
        <button className="wrapped-tap next" onClick={() => go(1)} disabled={at === slides.length - 1} aria-label="Next slide" />
      </div>
      <p className="muted small wrapped-count">
        {at + 1} of {slides.length}
      </p>
      <div className="wrapped-actions">
        <ShareButton
          what="wrapped"
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
