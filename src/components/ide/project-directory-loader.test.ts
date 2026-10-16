import assert from "node:assert/strict";
import { test, vi } from "vitest";
import {
  ProjectDirectoryLoader,
  type ProjectDirectoryResponse,
  resolveSelectedProjectFile,
} from "./project-directory-loader";

const rootResponse: ProjectDirectoryResponse = {
  directory: ".",
  entries: [
    { kind: "directory", path: "src" },
    { kind: "file", path: "README.md" },
  ],
};

test("expansion loads exactly one immediate directory and never refetches it", async () => {
  const fetchDirectory = vi.fn(async (directory: string) =>
    directory === "."
      ? rootResponse
      : { directory, entries: [{ kind: "file" as const, path: "src/a.ts" }] },
  );
  const loader = new ProjectDirectoryLoader({ fetchDirectory });
  await loader.load(".");

  await loader.syncExpandedDirectories(["src"]);
  await loader.syncExpandedDirectories(["src"]);
  await loader.syncExpandedDirectories([]);
  await loader.syncExpandedDirectories(["src"]);

  assert.deepEqual(
    fetchDirectory.mock.calls.map(([directory]) => directory),
    [".", "src"],
  );
});

test("simultaneous directory loads share one request", async () => {
  let resolveRequest:
    | ((response: ProjectDirectoryResponse) => void)
    | undefined;
  const fetchDirectory = vi.fn(
    () =>
      new Promise<ProjectDirectoryResponse>((resolve) => {
        resolveRequest = resolve;
      }),
  );
  const loader = new ProjectDirectoryLoader({ fetchDirectory });

  const first = loader.load(".");
  const second = loader.load(".");
  assert.equal(first, second);
  resolveRequest?.({ directory: ".", entries: [] });
  await Promise.all([first, second]);
  assert.equal(fetchDirectory.mock.calls.length, 1);
});

test("refresh invalidates loaded state and ignores stale responses", async () => {
  const pending: Array<(response: ProjectDirectoryResponse) => void> = [];
  const loaded = vi.fn();
  const fetchDirectory = vi.fn(
    () =>
      new Promise<ProjectDirectoryResponse>((resolve) => pending.push(resolve)),
  );
  const loader = new ProjectDirectoryLoader({
    fetchDirectory,
    onDirectoryLoaded: loaded,
  });

  const staleRequest = loader.load(".");
  loader.invalidate();
  assert.equal(loader.isLoaded("."), false);
  const currentRequest = loader.load(".");
  pending[0](rootResponse);
  assert.equal(await staleRequest, null);
  assert.equal(loaded.mock.calls.length, 0);
  pending[1](rootResponse);
  await currentRequest;
  assert.equal(loader.isLoaded("."), true);
  assert.equal(loaded.mock.calls.length, 1);
});

test("isLoading reflects in-flight requests and resets on invalidate", async () => {
  const pending: Array<(response: ProjectDirectoryResponse) => void> = [];
  const loader = new ProjectDirectoryLoader({
    fetchDirectory: () =>
      new Promise<ProjectDirectoryResponse>((resolve) => pending.push(resolve)),
  });

  assert.equal(loader.isLoading("."), false);
  const first = loader.load(".");
  assert.equal(loader.isLoading("."), true);

  loader.invalidate();
  assert.equal(loader.isLoading("."), false);
  assert.equal(loader.isLoaded("."), false);

  const second = loader.load(".");
  assert.equal(loader.isLoading("."), true);
  pending[0](rootResponse);
  pending[1](rootResponse);
  assert.equal(await first, null);
  await second;
  assert.equal(loader.isLoading("."), false);
  assert.equal(loader.isLoaded("."), true);
});

test("deep file reveal loads ancestors sequentially before selecting", async () => {
  const events: string[] = [];
  const responses: Record<string, ProjectDirectoryResponse> = {
    ".": {
      directory: ".",
      entries: [{ kind: "directory", path: "src" }],
    },
    src: {
      directory: "src",
      entries: [{ kind: "directory", path: "src/components" }],
    },
    "src/components": {
      directory: "src/components",
      entries: [{ kind: "file", path: "src/components/Button.tsx" }],
    },
  };
  const loader = new ProjectDirectoryLoader({
    fetchDirectory: async (directory) => {
      events.push(`load:${directory}`);
      return responses[directory];
    },
  });

  assert.equal(
    await loader.revealFile("src/components/Button.tsx", {
      expandDirectory: (directory) => events.push(`expand:${directory}`),
      revealFile: (filePath) => events.push(`reveal:${filePath}`),
    }),
    true,
  );
  assert.deepEqual(events, [
    "load:.",
    "load:src",
    "expand:src",
    "load:src/components",
    "expand:src/components",
    "reveal:src/components/Button.tsx",
  ]);
});

test("registered search results can be revealed and their directories loaded on expand", async () => {
  const events: string[] = [];
  const responses: Record<string, ProjectDirectoryResponse> = {
    ".": rootResponse,
    src: {
      directory: "src",
      entries: [{ kind: "directory", path: "src/components" }],
    },
    "src/components": {
      directory: "src/components",
      entries: [
        { kind: "file", path: "src/components/Button.tsx" },
        { kind: "file", path: "src/components/Input.tsx" },
      ],
    },
  };
  const loader = new ProjectDirectoryLoader({
    fetchDirectory: async (directory) => {
      events.push(`load:${directory}`);
      return responses[directory];
    },
  });
  await loader.load(".");

  // Simulate a search match injected into the tree without loading `src/`.
  loader.registerPaths(["src/components/Button.tsx"]);
  assert.equal(loader.knownDirectories.has("src/components"), true);
  assert.equal(loader.knownFiles.has("src/components/Button.tsx"), true);
  assert.equal(loader.isLoaded("src/components"), false);

  assert.equal(
    await loader.revealFile("src/components/Button.tsx", {
      expandDirectory: (directory) => events.push(`expand:${directory}`),
      revealFile: (filePath) => events.push(`reveal:${filePath}`),
    }),
    true,
  );
  assert.deepEqual(events, [
    "load:.",
    "load:src",
    "expand:src",
    "load:src/components",
    "expand:src/components",
    "reveal:src/components/Button.tsx",
  ]);
  assert.equal(loader.knownFiles.has("src/components/Input.tsx"), true);
});

test("expanding a directory known only from search results loads it", async () => {
  const fetchDirectory = vi.fn(async (directory: string) =>
    directory === "."
      ? rootResponse
      : {
          directory,
          entries: [{ kind: "file" as const, path: `${directory}/a.ts` }],
        },
  );
  const loader = new ProjectDirectoryLoader({ fetchDirectory });
  await loader.load(".");
  loader.registerPaths(["src/deep/nested/file.ts"]);

  await loader.syncExpandedDirectories(["src/deep/nested"]);

  assert.deepEqual(
    fetchDirectory.mock.calls.map(([directory]) => directory),
    [".", "src/deep/nested"],
  );
});

test("directory selection keeps the currently open file", () => {
  const files = new Set(["src/index.ts"]);
  assert.equal(
    resolveSelectedProjectFile("src/index.ts", "src/", files),
    "src/index.ts",
  );
  assert.equal(
    resolveSelectedProjectFile("src/index.ts", "README.md", files),
    "src/index.ts",
  );
  assert.equal(
    resolveSelectedProjectFile("src/index.ts", "src/index.ts", files),
    "src/index.ts",
  );
});

test("a failed child load can be retried after collapse and re-expansion", async () => {
  let attempts = 0;
  const fetchDirectory = vi.fn(async (directory: string) => {
    if (directory === ".") {
      return rootResponse;
    }
    attempts += 1;
    if (attempts === 1) {
      throw new Error("temporary failure");
    }
    return { directory, entries: [] };
  });
  const loader = new ProjectDirectoryLoader({ fetchDirectory });
  await loader.load(".");

  await loader.syncExpandedDirectories(["src"]);
  assert.equal(loader.isLoaded("src"), false);
  await loader.syncExpandedDirectories([]);
  await loader.syncExpandedDirectories(["src"]);

  assert.equal(attempts, 2);
  assert.equal(loader.isLoaded("src"), true);
});
