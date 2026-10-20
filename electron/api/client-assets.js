// The browser client's files, served by the remote listener (remote-app.js)
// from one directory: the renderer build (`dist/`, or `client/` in a host
// runtime). Only that directory's regular files are served, never another
// path on the host: no `..`, no dotfiles, no symlink that leads out of it,
// and nothing under /api.
//
//   /assets/*      content-hashed: cached for a year, immutable
//   anything else  revalidated every load (index.html, icons), so a host
//                  upgrade reaches the browser on its next load and the
//                  client always matches the host protocol it is served by
//   a page path    (/, /pair, ...) with no file: index.html
//
// No service worker is registered and no API response is cached (the
// listener marks /api responses no-store).
//
// index.html is sent with a Content Security Policy: scripts only from this
// origin plus the page's own inline boot script (by hash), no framing, no
// plugins. A session cookie is as good as a shell on the host, so script
// injection is closed off rather than merely unlikely.
import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

const TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "no-cache";

/** The page's inline scripts, by hash, for its CSP. */
const inlineScriptHashes = (html) =>
  [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(
    ([, body]) =>
      `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`,
  );

/** The Content Security Policy for `html`. */
export const clientContentSecurityPolicy = (html) =>
  [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${inlineScriptHashes(html).join(" ")}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

/**
 * The file under `root` that `requestPath` names, or null. Refuses anything
 * that would leave `root` or name a hidden file.
 */
const resolveClientFile = async (root, requestPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) return null;
  const candidate = path.resolve(root, ...segments);
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    return null;
  }
  try {
    // Through any symlink, still inside the directory, and a plain file.
    const real = await realpath(candidate);
    if (!real.startsWith(`${root}${path.sep}`)) return null;
    return (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
};

/**
 * Serves the client from `directory`. Returns a Hono handler for requests
 * no route answered (the listener's not-found handler), or null when there
 * is no client to serve.
 * @param {string | null | undefined} directory
 */
export const createClientAssets = async (directory) => {
  if (!directory) return null;
  let root;
  try {
    root = await realpath(path.resolve(directory));
    if (!(await stat(path.join(root, "index.html"))).isFile()) return null;
  } catch {
    return null;
  }

  /** @param {import("hono").Context} c */
  return async (c) => {
    const { method } = c.req;
    const requestPath = c.req.path;
    if (
      (method !== "GET" && method !== "HEAD") ||
      requestPath === "/api" ||
      requestPath.startsWith("/api/")
    ) {
      return c.text("Not found.", 404);
    }

    let file = await resolveClientFile(root, requestPath);
    if (!file) {
      // A page of the app (no extension): the app itself. A missing file
      // with an extension is missing, not the app.
      if (path.posix.extname(requestPath)) return c.text("Not found.", 404);
      file = path.join(root, "index.html");
    }

    const body = await readFile(file);
    const extension = path.extname(file).toLowerCase();
    const headers = {
      "Cache-Control": file.startsWith(
        `${path.join(root, "assets")}${path.sep}`,
      )
        ? IMMUTABLE
        : REVALIDATE,
      "Content-Type": TYPES[extension] ?? "application/octet-stream",
      "X-Frame-Options": "DENY",
    };
    if (extension === ".html") {
      headers["Content-Security-Policy"] = clientContentSecurityPolicy(
        body.toString("utf8"),
      );
    }
    return c.body(method === "HEAD" ? null : body, 200, headers);
  };
};
