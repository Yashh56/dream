// Draws every <Sparkles /> field on its OffscreenCanvas. One worker serves all
// fields with a single frame loop, which stops while nothing is visible.
import {
  createAmbientSparks,
  drawSparkSprite,
  getSparkExtent,
  getSparklesCanvasGeometry,
  type Spark,
  type SparkleKind,
  type SparklesCanvasGeometry,
  type SparklesFieldConfig,
  type SparklesWorkerMessage,
  sampleSpark,
} from "./sparkles-engine";

type Field = {
  canvas: OffscreenCanvas;
  config: SparklesFieldConfig;
  ctx: OffscreenCanvasRenderingContext2D;
  dpr: number;
  fieldWidth: number;
  geometry: SparklesCanvasGeometry;
  palette: string[];
  sparks: Spark[];
  sprites: Map<string, OffscreenCanvas>;
};

const fields = new Map<number, Field>();
let frameId: number | null = null;

// Wall-clock milliseconds, so clockSync phases match across windows.
const now = () => performance.timeOrigin + performance.now();

const resizeCanvas = (field: Field) => {
  field.geometry = getSparklesCanvasGeometry(field.config, field.fieldWidth);
  field.canvas.width = Math.max(
    1,
    Math.round(field.geometry.cssWidth * field.dpr),
  );
  field.canvas.height = Math.max(
    1,
    Math.round(field.geometry.cssHeight * field.dpr),
  );
  field.sprites.clear();
};

const rebuildSparks = (field: Field) => {
  field.sparks = createAmbientSparks({
    config: field.config,
    fieldWidth: field.fieldWidth,
    nowMs: now(),
    paletteLength: field.palette.length,
  });
};

const getSprite = (
  field: Field,
  kind: SparkleKind,
  size: number,
  color: string,
) => {
  const key = `${kind}|${size.toFixed(2)}|${color}`;
  const cached = field.sprites.get(key);
  if (cached) return cached;

  const side = Math.ceil(getSparkExtent(kind, size) * 2 * field.dpr) + 2;
  const sprite = new OffscreenCanvas(side, side);
  const ctx = sprite.getContext("2d");
  if (!ctx) return sprite;

  const paint = (target: OffscreenCanvasRenderingContext2D) => {
    target.translate(side / 2, side / 2);
    target.scale(field.dpr, field.dpr);
    drawSparkSprite(target, kind, size, color, field.dpr);
  };

  if (kind === "glow") {
    // The DOM version blurred the whole glow sparkle by 1px.
    const unblurred = new OffscreenCanvas(side, side);
    const unblurredCtx = unblurred.getContext("2d");
    if (unblurredCtx) {
      paint(unblurredCtx);
      ctx.filter = `blur(${field.dpr}px)`;
      ctx.drawImage(unblurred, 0, 0);
    }
  } else {
    paint(ctx);
  }

  field.sprites.set(key, sprite);
  return sprite;
};

const drawField = (field: Field, nowMs: number) => {
  const { ctx, dpr, geometry, palette } = field;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, field.canvas.width, field.canvas.height);
  if (palette.length === 0) return;

  const baseY = geometry.cssHeight - geometry.padY;
  for (const spark of field.sparks) {
    const sample = sampleSpark(spark, field.config.height, nowMs);
    if (!sample || sample.opacity <= 0 || sample.scale <= 0) continue;

    const sprite = getSprite(
      field,
      spark.kind,
      spark.size,
      palette[spark.colorIndex % palette.length],
    );
    const centerX = geometry.padX + spark.x + spark.size / 2 + sample.dx;
    const centerY = baseY - spark.size / 2 + sample.dy;
    ctx.globalAlpha = Math.min(1, sample.opacity);
    ctx.setTransform(
      sample.scale,
      0,
      0,
      sample.scale,
      centerX * dpr,
      centerY * dpr,
    );
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2);
  }
};

const renderFrame = () => {
  frameId = null;
  const nowMs = now();
  for (const field of fields.values()) {
    drawField(field, nowMs);
  }
  scheduleFrame();
};

function scheduleFrame() {
  if (frameId !== null) return;
  const hasSparks = [...fields.values()].some(
    (field) => field.sparks.length > 0,
  );
  if (hasSparks) {
    frameId = requestAnimationFrame(renderFrame);
  }
}

self.onmessage = (event: MessageEvent<SparklesWorkerMessage>) => {
  const message = event.data;

  if (message.type === "attach") {
    const ctx = message.canvas.getContext("2d");
    if (!ctx) return;
    const field: Field = {
      canvas: message.canvas,
      config: message.config,
      ctx,
      dpr: message.dpr,
      fieldWidth: message.fieldWidth,
      geometry: getSparklesCanvasGeometry(message.config, message.fieldWidth),
      palette: message.palette,
      sparks: [],
      sprites: new Map(),
    };
    fields.set(message.id, field);
    resizeCanvas(field);
    rebuildSparks(field);
    scheduleFrame();
    return;
  }

  const field = fields.get(message.id);
  if (!field) return;

  switch (message.type) {
    case "config":
      field.config = message.config;
      resizeCanvas(field);
      rebuildSparks(field);
      break;
    case "resize":
      field.dpr = message.dpr;
      field.fieldWidth = message.fieldWidth;
      resizeCanvas(field);
      // Matches the DOM version, which re-placed sparks whenever the field resized.
      rebuildSparks(field);
      break;
    case "palette":
      field.palette = message.palette;
      field.sprites.clear();
      break;
    case "detach":
      fields.delete(message.id);
      break;
  }
  scheduleFrame();
};
