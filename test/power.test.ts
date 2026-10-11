import { describe, expect, it } from "vitest";
import { gpuScores, levelFromSpecs, parseRequirements } from "../src/server/power.ts";

const req = (memory: string, graphics: string, storage = "10 GB available space") =>
  `<strong>Minimum:</strong><br><ul class="bb_ul"><li><strong>OS:</strong> Windows 10<br></li><li><strong>Memory:</strong> ${memory}<br></li><li><strong>Graphics:</strong> ${graphics}<br></li><li><strong>Storage:</strong> ${storage}</li></ul>`;
const level = (memory: string, graphics: string) => levelFromSpecs(parseRequirements(req(memory, graphics))!);

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

  it("does not take video memory for a card model", () => {
    expect(gpuScores("NVIDIA GEFORCE GTX 1060 3 GB or AMD RADEON RX 580 4 GB").every((s) => s >= 5.5)).toBe(true);
  });
});

describe("levelFromSpecs", () => {
  it("calls integrated graphics and tiny cards light", () => {
    expect(level("2 GB RAM", "Intel HD Graphics 4600")).toBe(1);
    expect(level("4 GB RAM", "1GB dedicated VRAM or better")).toBe(1);
    expect(level("2 GB RAM", "256 mb video memory, shader model 3.0+")).toBe(1);
  });

  it("calls an older real graphics card medium", () => {
    expect(level("8 GB RAM", "NVIDIA GeForce GTX 960 2GB / AMD Radeon R7 370 2GB")).toBe(2);
    expect(level("8 GB RAM", "Nvidia GTX 1650 4GB / AMD RX 5500XT 4GB / Intel ARC A380 6GB")).toBe(2);
  });

  it("calls a GTX 1060 class card or better demanding", () => {
    expect(level("12 GB RAM", "GeForce GTX 1060 6GB or Radeon RX 580 8GB or Arc A380")).toBe(3);
    expect(level("16 GB RAM", "NVIDIA GeForce RTX 2060")).toBe(3);
  });

  it("does not trust memory alone in the middle", () => {
    expect(level("8 GB RAM", "DirectX 11 compatible")).toBeNull();
    expect(level("1 GB RAM", "OpenGL 2.0 support")).toBe(1);
  });

  it("reads a vague card next to a lot of memory as medium", () => {
    expect(level("8 GB RAM", "Video card must be 1 GB or more")).toBe(2);
  });
});
