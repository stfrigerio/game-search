import { describe, expect, it } from "vitest";
import { gpuScores, levelFromSpecs, parseRequirements } from "../src/server/power.ts";

const req = (memory: string, graphics: string, storage = "10 GB available space") =>
  `<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li><li><strong>Memory:</strong> ${memory}<br></li><li><strong>Graphics:</strong> ${graphics}<br></li><li><strong>Storage:</strong> ${storage}</li></ul>`;

describe("parseRequirements", () => {
  it("reads memory, video memory, the card and disk space", () => {
    const s = parseRequirements(req("12 GB RAM", "GeForce GTX 1060 6GB or Radeon RX 580 8GB or Arc A380", "70 GB available space"))!;
    expect(s.ram).toBe(12);
    expect(s.vram).toBe(6);
    expect(s.disk).toBe(70);
    expect(s.gpu).toBeGreaterThanOrEqual(5.5);
    expect(s.gpuText).toContain("GTX 1060");
  });

  it("understands megabytes", () => {
    const s = parseRequirements(req("512 MB RAM", "256 mb video memory, shader model 3.0+", "500 MB available space"))!;
    expect(s.ram).toBe(0.5);
    expect(s.vram).toBe(0.3);
    expect(s.disk).toBe(0.5);
    expect(s.gpu).toBeNull();
  });

  it("returns null when there is nothing to read", () => {
    expect(parseRequirements("")).toBeNull();
    expect(parseRequirements("<strong>Minimum:</strong><br>A computer")).toBeNull();
  });
});

describe("gpuScores", () => {
  it("orders cards the way their speed does", () => {
    const one = (s: string) => gpuScores(s)[0];
    expect(one("Intel HD Graphics 4000")).toBeLessThan(one("GeForce GTX 660"));
    expect(one("GeForce GTX 660")).toBeLessThan(one("GeForce GTX 1060"));
    expect(one("GeForce GTX 1060")).toBeLessThan(one("GeForce RTX 3070"));
    expect(one("Radeon HD 7850")).toBeLessThan(one("Radeon RX 580"));
    expect(one("Radeon RX 580")).toBeLessThan(one("Radeon RX 6700 XT"));
  });

  it("reads cards written without a space before Ti", () => {
    expect(gpuScores("NVIDIA GeForce GTX 750Ti(2GB)")[0]).toBeGreaterThan(gpuScores("GeForce GTX 750")[0]);
    expect(gpuScores("NVIDIA GeForce GTX 650Ti 2GB, AMD Radeon HD 7750 2GB")).toHaveLength(2);
  });

  it("counts an Intel Arc card once, as an Arc", () => {
    expect(gpuScores("Nvidia GTX 970 / RX 480 / Intel Arc A380")).toHaveLength(3);
    expect(levelFromSpecs(parseRequirements(req("8 GB RAM", "Nvidia GTX 970 / RX 480 / Intel Arc A380 / Qualcomm Adreno X1 (4GB+ of VRAM)"))!)).toBe(3);
  });

  it("does not take video memory for a card model", () => {
    expect(gpuScores("NVIDIA GEFORCE GTX 1060 3 GB or AMD RADEON RX 580 4 GB").every((s) => s >= 5.5)).toBe(true);
  });
});

describe("levelFromSpecs", () => {
  const both = (min: [string, string], rec: [string, string] | null, hints = {}) =>
    levelFromSpecs(parseRequirements(req(...min), rec ? req(...rec) : "")!, hints);

  it("calls integrated graphics and tiny cards light", () => {
    expect(both(["2 GB RAM", "Intel HD Graphics 4600"], null)).toBe(1);
    expect(both(["2 GB RAM", "256 mb video memory, shader model 3.0+"], null)).toBe(1);
    expect(both(["4 GB RAM", "NVIDIA GeForce 8600/9600GT, ATI/AMD Radeon HD2600/3600"], null)).toBe(1);
  });

  it("does not call a game light because its minimum is low when it recommends a real card", () => {
    // Divinity: Original Sin 2
    expect(both(["4 GB RAM", "NVIDIA GeForce GTX 550 or ATI Radeon HD 6XXX or higher"], ["8 GB RAM", "NVIDIA GeForce GTX 770 or AMD R9 280"])).toBe(2);
    // Dying Light
    expect(both(["4 GB RAM", "NVIDIA GeForce GTX 560 / AMD Radeon HD 6870 (1GB VRAM)"], ["8 GB RAM", "NVIDIA GeForce GTX 780 / AMD Radeon R9 290 (2GB VRAM)"])).toBe(2);
  });

  it("keeps a 2D or old game light when its requirements land just above the line", () => {
    const hollowKnight: [[string, string], [string, string]] = [
      ["4 GB RAM", "GeForce GTX 560 Ti (1GB), Radeon HD 7750 (1GB)"],
      ["8 GB RAM", "GeForce GTX 950 (2GB)"],
    ];
    expect(both(...hollowKnight, { flat: true })).toBe(1);
    expect(both(...hollowKnight)).toBe(2);
    expect(both(["4 GB RAM", "1GB dedicated VRAM or better"], null, { year: 2006 })).toBe(1);
    expect(both(["8 GB RAM", "Video card must be 1 GB or more"], null, { year: 2012 })).toBe(2);
  });

  it("calls an older real graphics card medium", () => {
    expect(both(["8 GB RAM", "GeForce GTX 660"], ["8 GB RAM", "GeForce GTX 770"])).toBe(2);
    expect(both(["6 GB RAM", "AMD Radeon HD 7790 (2 GB), NVIDIA GeForce GTX 950"], ["8 GB RAM", "NVIDIA GeForce GTX 970 / AMD Radeon R9 290"])).toBe(2);
  });

  it("calls demanding what needs a GTX 1060 class card to play properly", () => {
    expect(both(["12 GB RAM", "GeForce GTX 1060 6GB or Radeon RX 580 8GB or Arc A380"], ["16 GB RAM", "GeForce RTX 2060 SUPER or Radeon RX 5700 XT or Arc A770"])).toBe(3);
    // Red Dead Redemption 2: a modest minimum, a GTX 1060 recommended
    expect(both(["8 GB RAM", "Nvidia GeForce GTX 770 2GB / AMD Radeon R9 280 3GB"], ["12 GB RAM", "Nvidia GeForce GTX 1060 6GB / AMD Radeon RX 480 4GB"])).toBe(3);
    expect(both(["8 GB RAM", "NVIDIA GTX 970 / AMD Radeon R9 390"], null)).toBe(3);
  });

  it("does not trust memory alone in the middle", () => {
    expect(both(["8 GB RAM", "DirectX 11 compatible"], null)).toBeNull();
    expect(both(["1 GB RAM", "OpenGL 2.0 support"], null)).toBe(1);
  });
});
