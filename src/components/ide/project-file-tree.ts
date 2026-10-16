/**
 * The project file tree: one `@pierre/trees` model kept in step with a
 * project's files.
 *
 * Directories load as they are expanded (`ProjectDirectoryLoader`), never
 * while the tree's search is open. Typing a filter consults a flat, cached
 * path index (`ProjectFileSearchIndex`) and injects only the matching paths,
 * so a search never walks the file system. Revealing a file loads and
 * expands its ancestors; a file that cannot be found once the root has
 * loaded is reported missing.
 *
 * The component owns the model's lifetime (`useFileTree`) and the DOM; it
 * mounts this module with `attach`, unmounts it with `detach`, and renders
 * its snapshot: how far the root has loaded and which directories failed.
 */
import type { FileTree } from "@pierre/trees";
import type { ProjectDirectoryResponse } from "@/lib/api-client";
import {
  ProjectDirectoryLoader,
  resolveSelectedProjectFile,
  toProjectTreePath,
} from "./project-directory-loader";
import { ProjectFileSearchIndex } from "./project-file-search-index";

/** How far the project's root listing has got. */
export type FileTreeRootStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export interface ProjectFileTreeSnapshot {
  rootStatus: FileTreeRootStatus;
  /** Keyed by directory ("." is the root): why its listing failed. */
  directoryErrors: Readonly<Record<string, string>>;
}

/** A reveal's answer: shown, not in the project, or overtaken by a refresh. */
export type FileRevealOutcome = "revealed" | "missing" | "superseded";

export interface ProjectFileTreeOptions {
  model: FileTree;
  fetchDirectory: (directory: string) => Promise<ProjectDirectoryResponse>;
  /** Every file path in the project, for the filter's path index. */
  fetchFiles: () => Promise<string[]>;
  /** Wait after the last keystroke before injecting matches. */
  searchDebounceMs?: number;
  /** At most this many matching paths are injected per query. */
  searchMatchLimit?: number;
}

const DEFAULT_SEARCH_DEBOUNCE_MS = 120;
const DEFAULT_SEARCH_MATCH_LIMIT = 200;

const INITIAL_SNAPSHOT: ProjectFileTreeSnapshot = {
  directoryErrors: {},
  rootStatus: "idle",
};

export class ProjectFileTree {
  readonly #model: FileTree;
  readonly #loader: ProjectDirectoryLoader;
  readonly #index: ProjectFileSearchIndex;
  readonly #searchDebounceMs: number;
  readonly #searchMatchLimit: number;
  readonly #listeners = new Set<() => void>();
  #snapshot = INITIAL_SNAPSHOT;
  #loadedVersion: number | null = null;
  #unsubscribeModel: (() => void) | null = null;
  #searchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ProjectFileTreeOptions) {
    this.#model = options.model;
    this.#searchDebounceMs =
      options.searchDebounceMs ?? DEFAULT_SEARCH_DEBOUNCE_MS;
    this.#searchMatchLimit =
      options.searchMatchLimit ?? DEFAULT_SEARCH_MATCH_LIMIT;
    this.#index = new ProjectFileSearchIndex({
      fetchFiles: options.fetchFiles,
    });
    this.#loader = new ProjectDirectoryLoader({
      fetchDirectory: options.fetchDirectory,
      onDirectoryError: (directory, error) => {
        this.#update({
          directoryErrors: {
            ...this.#snapshot.directoryErrors,
            [directory]:
              error instanceof Error
                ? error.message
                : "Failed to load project files.",
          },
          rootStatus: directory === "." ? "error" : this.#snapshot.rootStatus,
        });
      },
      onDirectoryLoaded: (response) => {
        this.#addPaths(response.entries.map(toProjectTreePath));
        const { [response.directory]: _cleared, ...directoryErrors } =
          this.#snapshot.directoryErrors;
        this.#update({
          directoryErrors,
          rootStatus:
            response.directory === "."
              ? response.entries.length === 0
                ? "empty"
                : "ready"
              : this.#snapshot.rootStatus,
        });
      },
    });
  }

  getSnapshot = (): ProjectFileTreeSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** Starts following the model: an expanded directory loads. */
  attach() {
    if (this.#unsubscribeModel) return;
    this.#syncExpansion();
    this.#unsubscribeModel = this.#model.subscribe(() => this.#syncExpansion());
  }

  /**
   * Stops following the model and forgets what was loaded: anything still
   * under way is ignored, and the next `load` starts over.
   */
  detach() {
    this.#unsubscribeModel?.();
    this.#unsubscribeModel = null;
    this.#clearSearchTimer();
    this.#loader.invalidate();
    this.#index.invalidate();
    this.#loadedVersion = null;
  }

  /**
   * Loads the project's root listing for `version` (a refresh bumps it).
   * The same version loads once, unless `detach` forgot it since.
   */
  load(version: number) {
    if (
      this.#loadedVersion === version &&
      (this.#loader.isLoaded(".") || this.#loader.isLoading("."))
    ) {
      return;
    }
    this.#loadedVersion = version;
    this.#loader.invalidate();
    this.#index.invalidate();
    this.#model.resetPaths([]);
    this.#update({ directoryErrors: {}, rootStatus: "loading" });
    void this.#loader.load(".").catch(() => undefined);
  }

  /** Lists a directory whose listing failed again. */
  retry(directory: string) {
    void this.#loader.load(directory).catch(() => undefined);
  }

  /**
   * The tree's filter changed: once typing pauses, the paths that match it
   * are added to the model so its own search can show them.
   */
  searchChanged(query: string | null) {
    this.#clearSearchTimer();
    if (!query) return;
    this.#searchTimer = setTimeout(() => {
      this.#searchTimer = null;
      void this.#injectSearchMatches(query);
    }, this.#searchDebounceMs);
  }

  /** Clears the tree's selection of anything but `path`. */
  deselectOthers(path: string | null) {
    for (const selected of this.#model.getSelectedPaths()) {
      if (selected !== path) {
        this.#model.getItem(selected)?.deselect();
      }
    }
  }

  /** Selects and focuses `path`, loading and expanding its ancestors. */
  async reveal(path: string): Promise<FileRevealOutcome> {
    const generation = this.#loader.generation;
    let revealed = false;
    try {
      revealed = await this.#loader.revealFile(path, {
        expandDirectory: (directory) => {
          const item = this.#model.getItem(`${directory}/`);
          if (item?.isDirectory() && "expand" in item) {
            item.expand();
          }
        },
        revealFile: (filePath) => {
          this.deselectOthers(filePath);
          this.#model.getItem(filePath)?.select();
          this.#model.focusPath(filePath);
        },
      });
    } catch {
      return "superseded";
    }
    if (revealed) return "revealed";
    return generation === this.#loader.generation && this.#loader.isLoaded(".")
      ? "missing"
      : "superseded";
  }

  /**
   * The file the tree's selection names; `current` when it names none (a
   * directory, or nothing). `selectedTreePath` is the selection a change
   * event reported; the model's own selection otherwise.
   */
  selectedFile(
    current: string | null,
    selectedTreePath: string | null = this.#model.getSelectedPaths()[0] ?? null,
  ): string | null {
    return resolveSelectedProjectFile(
      current,
      selectedTreePath,
      this.#loader.knownFiles,
    );
  }

  #update(next: ProjectFileTreeSnapshot) {
    this.#snapshot = next;
    for (const listener of this.#listeners) listener();
  }

  /** Adds tree paths the model lacks; adding one it has throws. */
  #addPaths(paths: readonly string[]) {
    const operations = paths
      .filter((path) => !this.#model.getItem(path))
      .map((path) => ({ path, type: "add" as const }));
    if (operations.length > 0) {
      this.#model.batch(operations);
    }
  }

  #syncExpansion() {
    // Search keeps its own projected expansion; it is never a request to
    // read the file system.
    if (this.#model.isSearchOpen()) return;
    const expanded: string[] = [];
    for (const directory of this.#loader.knownDirectories) {
      if (directory === ".") continue;
      const item = this.#model.getItem(`${directory}/`);
      if (item?.isDirectory() && "isExpanded" in item && item.isExpanded()) {
        expanded.push(directory);
      }
    }
    void this.#loader.syncExpandedDirectories(expanded);
  }

  async #injectSearchMatches(query: string) {
    const generation = this.#index.generation;
    const loaded = await this.#index.ensureLoaded();
    if (
      !loaded ||
      generation !== this.#index.generation ||
      this.#model.getSearchValue() !== query
    ) {
      return;
    }
    const paths = this.#index
      .search(query, this.#searchMatchLimit)
      .filter((path) => !this.#model.getItem(path));
    if (paths.length === 0) return;
    this.#loader.registerPaths(paths);
    this.#addPaths(paths);
  }

  #clearSearchTimer() {
    if (this.#searchTimer) {
      clearTimeout(this.#searchTimer);
      this.#searchTimer = null;
    }
  }
}
