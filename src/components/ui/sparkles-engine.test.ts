import { describe, expect, it } from "vitest";
import {
  createAmbientSparks,
  getSparkExtent,
  getSparklesCanvasGeometry,
  type Spark,
  type SparklesFieldConfig,
  sampleSpark,
} from "./sparkles-engine";

const config: SparklesFieldConfig = {
  clockSync: false,
  density: 40,
  height: 30,
  position: "top",
  shape: "mixed",
  sizeMul: 1,
  speed: 2,
  sway: 10,
  syncKey: "composer",
};

const spark = (overrides: Partial<Spark> = {}): Spark => ({
  colorIndex: 0,
  durationMs: 1000,
  epochMs: 0,
  kind: "star",
  size: 2,
  sway: 10,
  x: 50,
  ...overrides,
});

describe("sampleSpark", () => {
  it("follows the rise keyframes", () => {
    expect(sampleSpark(spark(), 100, 0)).toEqual({
      dx: 0,
      dy: 0,
      opacity: 0,
      scale: 0.3,
    });
    expect(sampleSpark(spark(), 100, 500)).toEqual({
      dx: 10,
      dy: -50,
      opacity: 1,
      scale: 1,
    });
    const nearEnd = sampleSpark(spark(), 100, 925);
    expect(nearEnd?.dy).toBeCloseTo(-97.5);
    expect(nearEnd?.opacity).toBeCloseTo(0.275);
  });

  it("repeats ambient sparks and hides them before they start", () => {
    expect(sampleSpark(spark(), 100, 1500)).toEqual(
      sampleSpark(spark(), 100, 500),
    );
    expect(sampleSpark(spark({ epochMs: 200 }), 100, 100)).toBeNull();
  });
});

describe("createAmbientSparks", () => {
  it("places the same sparks for the same syncKey and width", () => {
    const build = () =>
      createAmbientSparks({
        config,
        fieldWidth: 600,
        nowMs: 1000,
        paletteLength: 4,
      });
    const sparks = build();

    expect(sparks).toHaveLength(40);
    expect(build()).toEqual(sparks);
    for (const item of sparks) {
      expect(item.x).toBeGreaterThanOrEqual(6);
      expect(item.x).toBeLessThanOrEqual(594);
      expect(item.colorIndex).toBeLessThan(4);
      expect(Math.abs(item.sway)).toBeLessThanOrEqual(10);
    }
  });

  it("aligns clockSync phases to wall-clock time, not build time", () => {
    const build = (nowMs: number) =>
      createAmbientSparks({
        config: { ...config, clockSync: true },
        fieldWidth: 600,
        nowMs,
        paletteLength: 4,
      });

    expect(build(1000)).toEqual(build(987_654));
  });
});

describe("getSparklesCanvasGeometry", () => {
  it("covers the full rise, sway and glow of the largest spark", () => {
    const geometry = getSparklesCanvasGeometry(config, 600);
    const largestExtent = getSparkExtent("glow", 6);

    expect(geometry.padY).toBeGreaterThanOrEqual(largestExtent);
    expect(geometry.cssHeight).toBeGreaterThanOrEqual(
      config.height * 1.05 + 2 * largestExtent,
    );
    expect(geometry.padX).toBeGreaterThanOrEqual(largestExtent + config.sway);
    expect(geometry.cssWidth).toBe(600 + geometry.padX * 2);
  });
});
