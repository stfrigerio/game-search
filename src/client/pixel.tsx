import type { CSSProperties } from "react";

/**
 * Pixel art drawn as text: one character per square, as if coloured in on squared paper.
 * "." is empty, "K" is ink, "C" takes the text colour; the other letters are felt-tips,
 * a capital for the pen and the same letter small for its shaded side.
 */
const PENS: Record<string, string> = {
  K: "var(--ink)",
  N: "var(--ink-soft)",
  C: "currentColor",
  S: "#fff",
  W: "#fffdf6",
  w: "#e9dfc6",
  R: "var(--red)",
  D: "var(--red-deep)",
  r: "#ff94a0",
  Y: "var(--yellow)",
  y: "#f2b230",
  M: "var(--mint)",
  m: "#43b98a",
  B: "var(--sky)",
  b: "#1f7fd0",
  P: "var(--pink)",
  p: "#f2609b",
  V: "#9a7df0",
  v: "#6444cf",
  G: "var(--glass)",
  g: "#a8d3f0",
};

export interface Sprite {
  rows: string[];
}

const sprite = (art: string): Sprite => ({ rows: art.trim().split("\n").map((r) => r.trim()) });

export function Pixel({
  art,
  size = 3,
  className,
  label,
  style,
}: {
  art: Sprite;
  /** CSS pixels per square. */
  size?: number;
  className?: string;
  /** Read out by screen readers; without it the drawing is decoration. */
  label?: string;
  style?: CSSProperties;
}) {
  const w = Math.max(...art.rows.map((r) => r.length));
  const h = art.rows.length;
  const rects = [];
  for (let y = 0; y < h; y++) {
    const row = art.rows[y];
    // One rect per run of the same pen, so a sprite stays a few dozen nodes.
    for (let x = 0; x < row.length; ) {
      const pen = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === pen) end++;
      if (pen !== ".") rects.push(<rect key={`${x},${y}`} x={x} y={y} width={end - x} height={1} fill={PENS[pen] ?? pen} />);
      x = end;
    }
  }
  return (
    <svg
      className={className}
      style={style}
      width={w * size}
      height={h * size}
      viewBox={`0 0 ${w} ${h}`}
      shapeRendering="crispEdges"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {rects}
    </svg>
  );
}

/** The mark, and the favicon (public/favicon.svg is this drawing): a capsule with a face. */
export const BUDDY = sprite(`
.....KKKKKK.....
...KKYYYYYYKK...
..KKSSYYYYYYKK..
.KKSYYYYYYYYYKK.
.KYSYYYYYYYYYyK.
KYYYYYYYYYYYYyyK
KKKKKKKKKKKKKKKK
KWWWWWWWWWWWWwwK
KWWKKWWWWWWKKwwK
KWWKKWWWWWWKKwwK
KWWWWWKWWKWWwwwK
.KPPWWWKKWWwPPK.
.KKWWWWWWwwwwKK.
..KKwwwwwwwwKK..
...KKwwwwwwKK...
.....KKKKKK.....
`);

/** Keeps a game on your list. Takes the text colour, so it is empty until pressed. */
export const STAR = sprite(`
.....KK.....
....KCCK....
....KCCK....
...KCSCCK...
KKKKCSCCKKKK
KCCCCCCCCCCK
.KCCCCCCCCK.
..KCCCCCCK..
..KCCCCCCK..
.KCCCKKCCCK.
.KCCK..KCCK.
KKKK....KKKK
`);

/** How many players liked a game. */
export const HEART = sprite(`
.CC.CC.
CSCCCCC
CCCCCCC
.CCCCC.
..CCC..
...C...
`);

/** The capsule machine on the front page. */
export const MACHINE = sprite(`
.............KKKKKK.............
...........KrrRRRRRRK...........
...........KRRRRRRDDK...........
............KKKKKKKK............
...........KKKGGGGKKK...........
.........SSGGGGGGGGGGKK.........
........SGGGGGGGGGGGGGGK........
.......SGGGGGGKKKGGGGGGGK.......
......SSGGGGGKMSMKGGGGGGgK......
.....KSGGGGGKMSMMmKGGGGGGgK.....
.....SSGGGGGKMMMMmKGGGGGGgK.....
....KSGGGGGGKWWWWwKGGGGGGGgK....
....KGGGGGGGGKWWwKGGGGGGGGgK....
....KGGGGGKKKGKKKGKKKGGGGGgK....
...KGGGGGKYSYKGGGKVSVKGGKKKgK...
...KGGGGKYSYYyKGKVSVVvKKRSRKK...
...KGGGGKYYYYyKGKVVVVvKRSRRDK...
...KGGGGKWWWWwKGKWWWWwKRRRRDK...
....KGGGGKWWwKGGGKWWwKKWWWWK....
....KGGKKKKKKGGGGGKKKKKKWWwK....
....KGKPSPKGGGKKKGGGKMSMKKKK....
.....KPSPPpKGKBSBKGKMSMMmKK.....
.....KPPPPpKKBSBBbKKMMMMmKK.....
......KWWWwKKBBBBbKKWWWWwK......
.......KWwKGKWWWWwKGKWWwK.......
........KKgGGKWWwKgggKKK........
.....KKKNNNNNNNNNNNNNNNNKKK.....
....KDKKKKKKKKKKKKKKKKKKKKDK....
....KDDDDDDDDDKKKKDDDDDDDDDK....
....KRrRRRRRRRRRRRRRRRRRRDDK....
....KRrRRRRRRRRRRRRRRRRRRDDK....
....KRrRYYYYYyRRRRWWWwRRRDDK....
....KRrRYYKKYyRRRWWWWwwRRDDK....
....KRrRYYKKYyRRRKKKKKKRRDDK....
....KRrRYYKKYyRRRKKKKKKRRDDK....
....KRrRYYKKYyRRRWWWWwwRRDDK....
....KRrRyyyyyyRRRRwwwwRRRDDK....
....KRrRRRRRRRRRRRRRRRRRRDDK....
....KRrRKKKKKKKKKRRRRRRRRDDK....
....KRrRKNNNNNNNKRRRRRRRRDDK....
....KRRRKNNNNNNNKRRRRRRRRDDK....
....KDDDDDDDDDDDDDDDDDDDDDDK....
.....KKKKKKKKKKKKKKKKKKKKKK.....
.....KKKKKKK........KKKKKKK.....
.....KKKKKKK........KKKKKKK.....
......KKKKK..........KKKKK......
`);

/** A glint beside the machine. */
export const SPARK = sprite(`
...K...
..KYK..
.KKYKK.
KYYSYYK
.KKYKK.
..KYK..
...K...
`);

/** Loose change beside the machine. */
export const COIN = sprite(`
.KKKK.
KYYYYK
KYSYyK
KYSYyK
KYYyyK
.KKKK.
`);

/** Keeps you company while a list is empty or the catalogue loads. */
export const SLIME = sprite(`
..................
........KK........
.....KKSMMKKK.....
...KKMSMMMMMMKK...
..KMMMMMMMMMMMmK..
..KMMMMMMMMMMMMK..
.KMMSKMMMMMMSKMmK.
.KMMKKMMMMMMKKMmK.
KMMMKKMMMMMMKKMmmK
KMMMMMMKMMKMMMMmmK
KMPPMMMMKKMMMMPPMK
KMMMMMMMMMMMMMmmMK
KMmmmmmmmmmmmmmmMK
.KKKKKKKKKKKKKKKK.
`);
