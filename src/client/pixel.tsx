import type { CSSProperties } from "react";

/**
 * Pixel art drawn as text: one character per square, as if coloured in on squared paper.
 * "." is empty, "K" is ink, "C" takes the text colour; the other letters are felt-tips.
 */
const PENS: Record<string, string> = {
  K: "var(--ink)",
  C: "currentColor",
  W: "#fff",
  R: "var(--red)",
  D: "var(--red-deep)",
  Y: "var(--yellow)",
  O: "var(--orange)",
  P: "var(--pink)",
  B: "var(--sky)",
  M: "var(--mint)",
  V: "var(--grape)",
  G: "var(--glass)",
  S: "var(--glass-shine)",
  N: "var(--ink-soft)",
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

/** The mark: a magnifying glass that found something it likes. */
export const LOGO = sprite(`
...KKKKK....
..KWWWWWK...
.KWWRWRWWK..
.KWRRRRRWK..
.KWRRRRRWK..
.KWWRRRWWK..
.KWWWRWWWK..
..KWWWWWK...
...KKKKKKK..
........KKK.
.........KKK
..........KK
`);

export const STAR = sprite(`
.....K.....
....KCK....
....KCK....
KKKKKCKKKKK
KCCCCCCCCCK
.KCCCCCCCK.
..KCCCCCK..
..KCCKCCK..
.KCCK.KCCK.
.KKK...KKK.
`);

export const HEART = sprite(`
.CC.CC.
CCCCCCC
CCCCCCC
.CCCCC.
..CCC..
...C...
`);

/** The capsule machine on the front page. */
export const MACHINE = sprite(`
........KKKKKKKK........
......KKRRRRRRRRKK......
.....KRRRRRRRRRRRRK.....
....KKKKKKKKKKKKKKKK....
...KGGGGGGGGGGGGGGGGK...
..KGGSSGGGGGGGGGGGGGGK..
..KGSSGGGGGGGGGGGGGGGK..
..KGSGGGKKKGGGKKKGGGGK..
..KGSGGKYYYKGKVVVKGGGK..
..KGGGGKYYYKGKVVVKGGGK..
..KGGGGKWWWKGKWWWKGGGK..
..KGGGGGKKKGGGKKKGGGGK..
..KGGKKKGGGKKKGGGKKKGK..
..KGKPPPKGKBBBKGKMMMKK..
..KGKPPPKGKBBBKGKMMMKK..
..KGKWWWKGKWWWKGKWWWKK..
..KGGKKKGGGKKKGGGKKKGK..
..KKKKKKKKKKKKKKKKKKKK..
..KRRRRRRRRRRRRRRRRRRK..
..KRRRRRRRRRRRRRRRRRRK..
..KRRYYYYYRRRRKKKKKRRK..
..KRRYKKKYRRRKWWWWWKRK..
..KRRYKKKYRRRKWKKKWKRK..
..KRRYYYYYRRRKWWWWWKRK..
..KRRRRRRRRRRRKKKKKRRK..
..KRRKKKKKKKKKRRRRRRRK..
..KRRKNNNNNNNKRRRRRRRK..
..KRRKNNNNNNNKRRRRRRRK..
..KDDKKKKKKKKKDDDDDDDK..
..KDDDDDDDDDDDDDDDDDDK..
..KKKKKKKKKKKKKKKKKKKK..
...KKKK..........KKKK...
`);

export const CAPSULE = sprite(`
...KKKK...
.KKPPPPKK.
.KPWPPPPK.
KPWPPPPPPK
KPPPPPPPPK
KKKKKKKKKK
KWWWWWWWWK
.KWWWWWWK.
.KKWWWWKK.
...KKKK...
`);

/** Keeps you company while a list is empty or the catalogue loads. */
export const SLIME = sprite(`
....KKKK....
..KKMMMMKK..
.KMMWMMMMMK.
.KMWMMMMMMK.
KMMMMMMMMMMK
KMMKMMMMKMMK
KMMKMMMMKMMK
KMMMMKKMMMMK
KMMMMMMMMMMK
.KKKKKKKKKK.
`);
