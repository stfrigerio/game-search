/**
 * How strong a computer a game needs, in three steps. 1 runs on almost anything,
 * 2 wants a real graphics card, 3 wants a recent, strong one.
 */
export type PowerLevel = 1 | 2 | 3;

export const POWER = [
  { key: "low", level: 1, label: "Light", hint: "Runs on almost anything, integrated graphics included" },
  { key: "mid", level: 2, label: "Medium", hint: "Wants a graphics card, an older one will do" },
  { key: "high", level: 3, label: "Demanding", hint: "Wants a recent gaming PC" },
] as const;

export type PowerKey = (typeof POWER)[number]["key"];
export const POWER_BY_KEY = new Map<string, (typeof POWER)[number]>(POWER.map((p) => [p.key, p]));
export const POWER_BY_LEVEL = new Map<number, (typeof POWER)[number]>(POWER.map((p) => [p.level, p]));

/** What the store's system requirements say, as far as we could read them. */
export interface Specs {
  /** GB of memory. */
  ram: number | null;
  /** GB of video memory. */
  vram: number | null;
  /** GB of disk space. */
  disk: number | null;
  /** The graphics card asked for, on a scale where a GTX 1060 is 6. */
  gpu: number | null;
  /** The graphics line as the store words it. */
  gpuText: string;
  /** The same three for the recommended requirements, when the store gives them. */
  recGpu: number | null;
  recVram: number | null;
  recGpuText: string;
}
