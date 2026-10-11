import { useEffect, useRef, useState } from "react";
import type { MediaItem, MediaResponse } from "../../shared/types.ts";
import { api } from "../api.ts";

type Video = Extract<MediaItem, { kind: "video" }>;

/**
 * Plays a Steam trailer. Steam only serves trailers as HLS streams: Safari plays
 * those natively, other browsers get hls.js, loaded only when a trailer is played.
 * (Not hls.js's "light" build: Steam puts the audio in a separate track, which the
 * light build can't play.) Everything streams straight from Steam's CDN.
 */
function HlsVideo({ item, storeUrl }: { item: Video; storeUrl: string | null }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video || !item.hls) return;
    let destroy: (() => void) | undefined;
    let cancelled = false;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = item.hls;
    } else {
      import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setFailed(true);
          return;
        }
        const hls = new Hls({ capLevelToPlayerSize: true });
        hls.on(Hls.Events.ERROR, (_e, data) => data.fatal && setFailed(true));
        hls.loadSource(item.hls!);
        hls.attachMedia(video);
        destroy = () => hls.destroy();
      }, () => setFailed(true));
    }
    video.play().catch(() => {}); // autoplay may be refused; the controls are there
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [item]);

  if (failed) {
    return (
      <p className="media-fallback">
        This browser can't play Steam's trailer stream (it needs H.264 video).
        {storeUrl && (
          <>
            {" "}
            <a href={storeUrl} target="_blank" rel="noreferrer">
              Watch it on the store page
            </a>
          </>
        )}
      </p>
    );
  }
  return <video ref={ref} controls autoPlay playsInline poster={item.poster ?? undefined} aria-label={item.title} />;
}

function Stage({
  item,
  playing,
  onPlay,
  storeUrl,
}: {
  item: MediaItem;
  playing: boolean;
  onPlay: () => void;
  storeUrl: string | null;
}) {
  if (item.kind === "image") {
    return (
      <a href={item.full} target="_blank" rel="noreferrer" title="Open full size">
        <img src={item.full} alt="Screenshot" />
      </a>
    );
  }
  if (!playing) {
    return (
      <button className="media-poster" onClick={onPlay} aria-label={`Play ${item.title}`}>
        {item.poster && <img src={item.poster} alt="" />}
        <span className="play-button" aria-hidden="true">▶</span>
        <span className="media-caption">{item.title}</span>
      </button>
    );
  }
  if (item.youtube) {
    return (
      <iframe
        src={`https://www.youtube-nocookie.com/embed/${item.youtube}?autoplay=1&rel=0`}
        title={item.title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
      />
    );
  }
  return <HlsVideo item={item} storeUrl={storeUrl} />;
}

/**
 * Screenshots and trailers for the game page. Nothing is stored or proxied by us:
 * the server only looks up URLs, the browser loads the files from the store's CDN,
 * and trailers stream only once played.
 */
export function MediaGallery({ id, storeUrl }: { id: string; storeUrl: string | null }) {
  const [media, setMedia] = useState<MediaResponse | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const strip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMedia(null);
    setIndex(0);
    setPlaying(false);
    let live = true;
    api.media(id).then(
      (m) => live && setMedia(m),
      () => live && setMedia({ items: [], error: "Couldn't load screenshots" }),
    );
    return () => {
      live = false;
    };
  }, [id]);

  const items = media?.items ?? [];
  const select = (i: number) => {
    const next = (i + items.length) % items.length;
    setIndex(next);
    setPlaying(false);
    strip.current?.children[next]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  };

  if (!media) return <div className="media-gallery loading" aria-busy="true" />;
  if (!items.length) return null;
  const current = items[Math.min(index, items.length - 1)];

  return (
    <section
      className="media-gallery"
      aria-label="Screenshots and trailers"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") select(index + 1);
        else if (e.key === "ArrowLeft") select(index - 1);
        else return;
        e.preventDefault();
      }}
    >
      <div className="media-stage">
        <Stage item={current} playing={playing} onPlay={() => setPlaying(true)} storeUrl={storeUrl} />
        {items.length > 1 && (
          <>
            <button className="media-nav prev" onClick={() => select(index - 1)} aria-label="Previous">
              ‹
            </button>
            <button className="media-nav next" onClick={() => select(index + 1)} aria-label="Next">
              ›
            </button>
          </>
        )}
      </div>
      {items.length > 1 && (
        <div className="media-strip" ref={strip}>
          {items.map((item, i) => (
            <button
              key={i}
              className={`media-thumb ${i === index ? "on" : ""} ${item.kind}`}
              onClick={() => select(i)}
              aria-label={item.kind === "video" ? item.title : `Screenshot ${i + 1}`}
              aria-current={i === index}
            >
              {item.thumb ? <img src={item.thumb} alt="" loading="lazy" /> : <span className="thumb-blank" />}
              {item.kind === "video" && <span className="thumb-play" aria-hidden="true">▶</span>}
            </button>
          ))}
        </div>
      )}
      <p className="muted small media-credit">
        {index + 1} / {items.length} · streamed from the store
      </p>
    </section>
  );
}
