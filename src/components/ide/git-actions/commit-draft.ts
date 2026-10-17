/**
 * A commit being written: its message, whether it takes unstaged changes,
 * whether the message is generated, and committing it (or committing and
 * pushing). The Changes tab's commit box and the commit dialog both render
 * one; they differ only in layout and in what follows a commit.
 *
 * With generation on, the message is the one generated for the changes the
 * commit takes (git-generated-text.ts): shown at once when it already
 * exists, else generated, and a generation the inputs have since overtaken
 * is ignored. While generation may not run (the panel is hidden, its status
 * is not current, an agent is still writing) the message stays as it is.
 */
import { useTranslations } from "next-intl";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  type ApiClient,
  apiClient,
  getApiErrorMessage,
} from "@/lib/api-client";
import type {
  ProjectGitStatusEntry,
  ProjectGitStatusResponse,
} from "@/types/ide";
import {
  type CommitMessageRequest,
  cachedCommitMessage,
  type GitGenerationSettings,
  generateCommitMessage,
  selectCommitChanges,
} from "../git-generated-text";
import { hasPushDestination } from "./utils";

export type CommitAction = "commit" | "commit-push";

export interface CommitDraftInputs extends GitGenerationSettings {
  projectPath: string;
  /** A full status read of the project (or worktree) being committed. */
  status: ProjectGitStatusResponse | null;
  /** Whether a message may be generated now. */
  canGenerate: boolean;
}

/** Why the draft failed; the composer puts it into words. */
export type CommitDraftError =
  | { kind: "generate" }
  | { kind: "submit"; action: CommitAction; error: unknown };

export interface CommitDraftSnapshot {
  autoGenerate: boolean;
  /** The changes the commit takes. */
  changes: ProjectGitStatusEntry[];
  canCommit: boolean;
  canCommitPush: boolean;
  error: CommitDraftError | null;
  generating: boolean;
  includeUnstaged: boolean;
  message: string;
  submitting: CommitAction | null;
}

export interface CommitDraftDependencies {
  api: Pick<ApiClient, "gitCommit" | "gitPush">;
  text?: {
    cached: (request: CommitMessageRequest) => string | undefined;
    generate: (request: CommitMessageRequest) => Promise<string>;
  };
}

const INITIAL: CommitDraftSnapshot = {
  autoGenerate: true,
  canCommit: false,
  canCommitPush: false,
  changes: [],
  error: null,
  generating: false,
  includeUnstaged: true,
  message: "",
  submitting: null,
};

export class CommitDraft {
  readonly #api: CommitDraftDependencies["api"];
  readonly #text: NonNullable<CommitDraftDependencies["text"]>;
  readonly #listeners = new Set<() => void>();
  #inputs: CommitDraftInputs | null = null;
  #snapshot = INITIAL;
  /** Bumped by anything that makes a generation under way stale. */
  #generation = 0;

  constructor({
    api,
    text = { cached: cachedCommitMessage, generate: generateCommitMessage },
  }: CommitDraftDependencies) {
    this.#api = api;
    this.#text = text;
  }

  getSnapshot = (): CommitDraftSnapshot => this.#snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** The project, status, model or permission to generate changed. */
  update(inputs: CommitDraftInputs) {
    this.#inputs = inputs;
    this.#set({});
    this.#syncMessage();
  }

  setMessage(message: string) {
    this.#set({ message });
  }

  setIncludeUnstaged(includeUnstaged: boolean) {
    this.#set({ includeUnstaged });
    this.#syncMessage();
  }

  /** Turning generation off clears the message for the user to write. */
  setAutoGenerate(autoGenerate: boolean) {
    this.#set({
      autoGenerate,
      generating: false,
      ...(autoGenerate ? {} : { message: "" }),
    });
    this.#syncMessage();
  }

  /** Back to a fresh draft (a dialog opening). */
  reset() {
    this.#generation += 1;
    this.#snapshot = INITIAL;
    this.#set({});
    this.#syncMessage();
  }

  /** Ignores any generation still under way (the composer went away). */
  dispose() {
    this.#generation += 1;
  }

  /** Commits, or commits and pushes. True when it went through. */
  async submit(action: CommitAction): Promise<boolean> {
    const draft = this.#snapshot;
    const projectPath = this.#inputs?.projectPath;
    if (
      !projectPath ||
      draft.submitting !== null ||
      !draft.canCommit ||
      (action === "commit-push" && !draft.canCommitPush)
    ) {
      return false;
    }

    this.#set({ error: null, submitting: action });
    try {
      if (action === "commit-push") {
        await this.#api.gitPush({
          commitMessage: draft.message,
          includeUnstaged: draft.includeUnstaged,
          nextStep: "commit-push",
          projectPath,
        });
      } else {
        await this.#api.gitCommit({
          includeUnstaged: draft.includeUnstaged,
          message: draft.message,
          projectPath,
        });
      }
      this.#set({ message: "", submitting: null });
      return true;
    } catch (error) {
      this.#set({ error: { action, error, kind: "submit" }, submitting: null });
      return false;
    }
  }

  /** Applies `next` and re-derives what follows from it. */
  #set(next: Partial<CommitDraftSnapshot>) {
    const merged = { ...this.#snapshot, ...next };
    const status = this.#inputs?.status ?? null;
    const changes = selectCommitChanges(
      status?.changes,
      merged.includeUnstaged,
    );
    const canCommit =
      changes.length > 0 &&
      merged.message.trim().length > 0 &&
      !merged.generating &&
      merged.submitting === null;
    this.#snapshot = {
      ...merged,
      canCommit,
      canCommitPush: canCommit && hasPushDestination(status),
      changes,
    };
    for (const listener of this.#listeners) listener();
  }

  /** Shows, generates or keeps the message, as the inputs now allow. */
  #syncMessage() {
    this.#generation += 1;
    const generation = this.#generation;
    const inputs = this.#inputs;
    const { autoGenerate, changes, includeUnstaged } = this.#snapshot;
    if (!inputs || !autoGenerate || !inputs.canGenerate) {
      if (this.#snapshot.generating) this.#set({ generating: false });
      return;
    }
    if (changes.length === 0) {
      this.#set({ generating: false, message: "" });
      return;
    }

    const request: CommitMessageRequest = {
      changes,
      includeUnstaged,
      model: inputs.model,
      modelSpeed: inputs.modelSpeed,
      projectPath: inputs.projectPath,
      provider: inputs.provider,
      reasoningEffort: inputs.reasoningEffort,
    };
    const cached = this.#text.cached(request);
    if (cached !== undefined) {
      this.#set({ generating: false, message: cached });
      return;
    }

    this.#set({ error: null, generating: true, message: "" });
    this.#text.generate(request).then(
      (message) => {
        if (generation === this.#generation) {
          this.#set({ generating: false, message });
        }
      },
      () => {
        if (generation === this.#generation) {
          this.#set({ error: { kind: "generate" }, generating: false });
        }
      },
    );
  }
}

/** A commit draft for one composer, kept in step with its inputs. */
export const useCommitDraft = ({
  canGenerate,
  model,
  modelSpeed,
  projectPath,
  provider,
  reasoningEffort,
  status,
}: CommitDraftInputs) => {
  const [draft] = useState(() => new CommitDraft({ api: apiClient }));
  const snapshot = useSyncExternalStore(draft.subscribe, draft.getSnapshot);

  useEffect(() => {
    draft.update({
      canGenerate,
      model,
      modelSpeed,
      projectPath,
      provider,
      reasoningEffort,
      status,
    });
  }, [
    canGenerate,
    draft,
    model,
    modelSpeed,
    projectPath,
    provider,
    reasoningEffort,
    status,
  ]);

  useEffect(() => () => draft.dispose(), [draft]);

  return { draft, snapshot };
};

/** A draft's error in words, for either composer. */
export const useCommitDraftErrorText = (error: CommitDraftError | null) => {
  const gitT = useTranslations("git");
  if (!error) return null;
  if (error.kind === "generate") return gitT("unableToGenerateCommitMessage");
  return getApiErrorMessage(
    error.error,
    error.action === "commit-push"
      ? gitT("unableToCommitAndPush")
      : gitT("unableToCommit"),
  );
};
