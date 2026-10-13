// Shared by <Sparkles /> and its worker. Everything here is pure: spark
// placement, the rise curve, canvas geometry and sprite drawing. The worker
// owns the canvases, so a running sparkles field costs no main-thread frames.

export type SparkleKind = "star" | "dot" | "glow" | "diamond" | "plus";
export type SparklesShape = "mixed" | SparkleKind;
export type SparklesPosition = "top" | "bottom";

export type SparklesFieldConfig = {
  clockSync: boolean;
  density: number;
  height: number;
  position: SparklesPosition;
  shape: SparklesShape;
  sizeMul: number;
  speed: number;
  sway: number;
  syncKey?: string;
};

export type Spark = {
  colorIndex: number;
  durationMs: number;
  /** Wall-clock time (ms) at which the spark's first cycle starts. */
  epochMs: number;
  kind: SparkleKind;
  size: number;
  sway: number;
  /** Left edge of the spark, in CSS px from the field's left edge. */
  x: number;
};

export type SparklesCanvasGeometry = {
  cssHeight: number;
  cssWidth: number;
  padX: number;
  padY: number;
};

export type SparklesWorkerMessage =
  | {
      canvas: OffscreenCanvas;
      config: SparklesFieldConfig;
      dpr: number;
      fieldWidth: number;
      id: number;
      palette: string[];
      type: "attach";
    }
  | { config: SparklesFieldConfig; id: number; type: "config" }
  | { dpr: number; fieldWidth: number; id: number; type: "resize" }
  | { id: number; palette: string[]; type: "palette" }
  | { id: number; type: "detach" };

const DEFAULT_FIELD_WIDTH = 700;
/** Glow sparks are up to 6px before sizeMul; every other kind is 2 or 3px. */
const LARGEST_SPARK_BASE_SIZE = 6;

/** Keyframes of the rise: x is a multiple of the spark's sway, y of the rise height. */
const RISE_STOPS = [
  { at: 0, opacity: 0, scale: 0.3, x: 0, y: 0 },
  { at: 0.1, opacity: 1, scale: 1, x: 0, y: -0.05 },
  { at: 0.5, opacity: 1, scale: 1, x: 1, y: -0.5 },
  { at: 0.85, opacity: 0.55, scale: 0.8, x: -0.4, y: -0.9 },
  { at: 1, opacity: 0, scale: 0.2, x: -0.8, y: -1.05 },
] as const;

function hashSeed(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSeededRandom(seed: string) {
  let t = hashSeed(seed);
  return () => {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Places a field's ambient sparks. The random draws keep the order of the
 * original DOM implementation, so a syncKey still gives the same layout.
 */
export function createAmbientSparks({
  config,
  fieldWidth,
  nowMs,
  paletteLength,
  random: providedRandom,
}: {
  config: SparklesFieldConfig;
  fieldWidth: number;
  nowMs: number;
  paletteLength: number;
  random?: () => number;
}): Spark[] {
  const width = fieldWidth || DEFAULT_FIELD_WIDTH;
  const random =
    providedRandom ??
    (config.syncKey
      ? createSeededRandom(
          `${config.syncKey}:${config.density}:${config.position}:${config.shape}:${width}`,
        )
      : Math.random);
  const range = (a: number, b: number) => a + random() * (b - a);
  const sparks: Spark[] = [];

  for (let i = 0; i < config.density; i++) {
    let kind: SparkleKind;
    if (config.shape === "mixed") {
      const r = random();
      kind = r < 0.5 ? "star" : r < 0.75 ? "dot" : r < 0.9 ? "glow" : "diamond";
    } else {
      kind = config.shape;
    }

    const baseSize = kind === "glow" ? range(3, 6) : random() < 0.6 ? 2 : 3;
    const durationS = range(2.2, 5.8) / config.speed;
    const x = range(6, width - 6);
    const clockOffsetS = range(0, durationS);
    const delayS = config.clockSync ? 0 : range(-durationS, 0.2);
    const sway = range(-config.sway, config.sway);
    const colorIndex = Math.min(
      paletteLength - 1,
      Math.floor(random() * paletteLength),
    );

    sparks.push({
      colorIndex,
      durationMs: durationS * 1000,
      // clockSync aligns the phase to wall-clock time, so every window that
      // shares a syncKey shows the same sparks at the same height.
      epochMs: config.clockSync ? -clockOffsetS * 1000 : nowMs + delayS * 1000,
      kind,
      size: Math.max(1, baseSize * config.sizeMul),
      sway,
      x,
    });
  }

  return sparks;
}

export type SparkSample = {
  dx: number;
  dy: number;
  opacity: number;
  scale: number;
};

/** Where a spark is at `nowMs`, or null when it is not visible. */
export function sampleSpark(
  spark: Spark,
  rise: number,
  nowMs: number,
): SparkSample | null {
  const elapsed = nowMs - spark.epochMs;
  if (elapsed < 0) {
    return null;
  }

  const progress = (elapsed % spark.durationMs) / spark.durationMs;
  let index = 1;
  while (index < RISE_STOPS.length - 1 && RISE_STOPS[index].at < progress) {
    index++;
  }
  const from = RISE_STOPS[index - 1];
  const to = RISE_STOPS[index];
  const t = (progress - from.at) / (to.at - from.at);
  const lerp = (a: number, b: number) => a + (b - a) * t;

  return {
    dx: lerp(from.x, to.x) * spark.sway,
    dy: lerp(from.y, to.y) * rise,
    opacity: lerp(from.opacity, to.opacity),
    scale: lerp(from.scale, to.scale),
  };
}

/** Half-width, in CSS px, of a spark sprite including its glow. */
export function getSparkExtent(kind: SparkleKind, size: number) {
  switch (kind) {
    case "diamond":
      return size * 2.5;
    case "star":
    case "plus":
      return size * 1.5;
    case "dot":
      return size / 2 + 8;
    case "glow":
      return size / 2 + 16;
  }
}

/** The canvas covers the field plus room for sparks to rise, sway and glow. */
export function getSparklesCanvasGeometry(
  config: SparklesFieldConfig,
  fieldWidth: number,
): SparklesCanvasGeometry {
  const padY = Math.ceil(
    getSparkExtent("glow", LARGEST_SPARK_BASE_SIZE * config.sizeMul),
  );
  const padX = Math.ceil(padY + Math.abs(config.sway));

  return {
    cssHeight: Math.ceil(config.height * 1.05) + padY * 2,
    cssWidth: Math.max(0, fieldWidth) + padX * 2,
    padX,
    padY,
  };
}

type SpriteContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

const fillSquares = (
  ctx: SpriteContext,
  size: number,
  offsets: readonly (readonly [number, number])[],
) => {
  for (const [x, y] of offsets) {
    ctx.fillRect(x * size - size / 2, y * size - size / 2, size, size);
  }
};

const fillCircleWithShadows = (
  ctx: SpriteContext,
  size: number,
  color: string,
  shadows: readonly (readonly [string, number])[],
  dpr: number,
) => {
  ctx.fillStyle = color;
  // CSS paints the first box-shadow on top, so draw the list in reverse.
  for (const [shadowColor, blur] of [...shadows].reverse()) {
    ctx.shadowColor = shadowColor;
    // Canvas shadows ignore the transform, so blur is given in device px.
    ctx.shadowBlur = blur * dpr;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
};

const ORTHOGONAL = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;
const DIAGONAL = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
] as const;
const DIAMOND = [[0, -2], [0, 2], [-2, 0], [2, 0], ...ORTHOGONAL] as const;

/**
 * Draws one spark centred on the origin, in CSS px. Matches the pixel shapes
 * the DOM version built from box-shadows. CSS never paints an outer shadow
 * inside the element's own box, so star, plus and diamond have a hollow centre.
 */
export function drawSparkSprite(
  ctx: SpriteContext,
  kind: SparkleKind,
  size: number,
  color: string,
  dpr: number,
) {
  ctx.fillStyle = color;
  switch (kind) {
    case "star":
      fillSquares(ctx, size, ORTHOGONAL);
      ctx.globalAlpha = 0.45;
      fillSquares(ctx, size, DIAGONAL);
      ctx.globalAlpha = 1;
      return;
    case "plus":
      fillSquares(ctx, size, ORTHOGONAL);
      return;
    case "diamond":
      fillSquares(ctx, size, DIAMOND);
      return;
    case "dot":
      fillCircleWithShadows(
        ctx,
        size,
        color,
        [
          [color, 6],
          ["#fff", 2],
        ],
        dpr,
      );
      return;
    case "glow":
      fillCircleWithShadows(
        ctx,
        size,
        color,
        [
          [color, 12],
          [color, 4],
          ["#fff", 2],
        ],
        dpr,
      );
      return;
  }
}
