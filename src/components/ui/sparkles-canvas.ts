// Main-thread side of <Sparkles />: owns one field's <canvas> element and
// hands drawing to the shared sparkles worker.
import {
  getSparklesCanvasGeometry,
  type SparklesFieldConfig,
  type SparklesWorkerMessage,
} from "./sparkles-engine";

export type SparklesSurface = {
  detach: () => void;
  setConfig: (config: SparklesFieldConfig) => void;
  setPalette: (palette: readonly string[]) => void;
};

let worker: Worker | null = null;
let nextFieldId = 1;

const postToWorker = (
  message: SparklesWorkerMessage,
  transfer: Transferable[] = [],
) => {
  worker ??= new Worker(new URL("./sparkles.worker.ts", import.meta.url), {
    name: "sparkles",
    type: "module",
  });
  worker.postMessage(message, transfer);
};

export const canRenderSparklesCanvas = () =>
  typeof Worker === "function" &&
  typeof HTMLCanvasElement !== "undefined" &&
  "transferControlToOffscreen" in HTMLCanvasElement.prototype;

const isSameConfig = (a: SparklesFieldConfig, b: SparklesFieldConfig) =>
  (Object.keys(a) as (keyof SparklesFieldConfig)[]).every(
    (key) => a[key] === b[key],
  ) && Object.keys(a).length === Object.keys(b).length;

/**
 * Starts drawing sparkles into a new canvas inside `field`. Returns null where
 * an OffscreenCanvas worker is unavailable; the field then shows only its glow.
 */
export function attachSparklesCanvas(
  field: HTMLElement,
  initialConfig: SparklesFieldConfig,
  initialPalette: readonly string[],
): SparklesSurface | null {
  if (!canRenderSparklesCanvas()) {
    return null;
  }

  const id = nextFieldId++;
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.pointerEvents = "none";
  // Canvas fill styles cannot read CSS variables, so palette entries such as
  // var(--accent-primary) are resolved to concrete colors through this probe.
  const colorProbe = document.createElement("span");
  colorProbe.hidden = true;
  field.append(canvas, colorProbe);

  let config = initialConfig;
  let palette = initialPalette;
  let fieldWidth = field.clientWidth;
  let dpr = window.devicePixelRatio || 1;

  const resolveColors = () =>
    palette.map((color) => {
      colorProbe.style.color = "";
      colorProbe.style.color = color;
      return getComputedStyle(colorProbe).color;
    });
  let colors = resolveColors();

  const applyCanvasGeometry = () => {
    const geometry = getSparklesCanvasGeometry(config, fieldWidth);
    canvas.style.left = `${-geometry.padX}px`;
    canvas.style.bottom = `${-geometry.padY}px`;
    canvas.style.width = `${geometry.cssWidth}px`;
    canvas.style.height = `${geometry.cssHeight}px`;
  };
  applyCanvasGeometry();

  const offscreen = canvas.transferControlToOffscreen();
  postToWorker(
    {
      canvas: offscreen,
      config,
      dpr,
      fieldWidth,
      id,
      palette: colors,
      type: "attach",
    },
    [offscreen],
  );

  const handleSizeChange = () => {
    const nextWidth = field.clientWidth;
    const nextDpr = window.devicePixelRatio || 1;
    if (nextWidth === fieldWidth && nextDpr === dpr) return;
    fieldWidth = nextWidth;
    dpr = nextDpr;
    applyCanvasGeometry();
    postToWorker({ dpr, fieldWidth, id, type: "resize" });
  };
  const resizeObserver = new ResizeObserver(handleSizeChange);
  resizeObserver.observe(field);

  // Moving the window to a display with a different scale changes the device
  // pixel ratio without resizing the field.
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = () => {
    dprQuery?.removeEventListener("change", handleDprChange);
    dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    dprQuery.addEventListener("change", handleDprChange);
  };
  function handleDprChange() {
    handleSizeChange();
    watchDpr();
  }
  watchDpr();

  const refreshColors = () => {
    const nextColors = resolveColors();
    if (nextColors.join("\u0000") === colors.join("\u0000")) return;
    colors = nextColors;
    postToWorker({ id, palette: colors, type: "palette" });
  };
  // Theme and accent changes restyle the root element.
  const themeObserver = new MutationObserver(refreshColors);
  themeObserver.observe(document.documentElement, { attributes: true });

  return {
    detach: () => {
      resizeObserver.disconnect();
      themeObserver.disconnect();
      dprQuery?.removeEventListener("change", handleDprChange);
      postToWorker({ id, type: "detach" });
      canvas.remove();
      colorProbe.remove();
    },
    setConfig: (nextConfig) => {
      if (isSameConfig(config, nextConfig)) return;
      config = nextConfig;
      applyCanvasGeometry();
      postToWorker({ config, id, type: "config" });
    },
    setPalette: (nextPalette) => {
      palette = nextPalette;
      refreshColors();
    },
  };
}
