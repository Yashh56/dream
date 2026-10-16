import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiClient, getApiErrorMessage } from "@/lib/api-client";
import { getDefaultGitGenerationModelSelection } from "@/lib/ide-defaults";
import type { ProjectGitStatusResponse } from "@/types/ide";
import { hasPushDestination } from "../git-actions/utils";
import {
  generateCachedProjectCommitMessage,
  getCachedProjectCommitMessage,
  getCommitChanges,
} from "../git-commit-message-cache";
import { useIdeStore } from "../ide-store";
import { useCommitMessageFocusRequest } from "./show-git-panel";

type CommitAction = "commit" | "commit-push";

/**
 * The Changes tab's commit composer, as the commit dialog was: whether to
 * include unstaged changes, whether to generate the message (on by default,
 * read from the message generated after the last agent turn when there is
 * one), the message, and Commit or Commit & push.
 */
const GitCommitBoxImpl = ({
  active,
  projectId,
  projectPath,
  status,
}: {
  /** Whether the Changes tab is the one shown in a visible Git panel. */
  active: boolean;
  projectId: string;
  projectPath: string;
  /** A full status read. */
  status: ProjectGitStatusResponse | null;
}) => {
  const gitT = useTranslations("git");
  const gitRefreshKey = useIdeStore(
    (s) => s.projectGitRefreshKeys[projectId] ?? 0,
  );
  const bumpProjectGitRefreshKey = useIdeStore(
    (s) => s.bumpProjectGitRefreshKey,
  );
  const settings = useIdeStore((s) => s.settings);
  const { model, modelSpeed, provider, reasoningEffort } = useMemo(
    () => getDefaultGitGenerationModelSelection(settings),
    [settings],
  );
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState("");
  const [autoGenerateMessage, setAutoGenerateMessage] = useState(true);
  const [includeUnstaged, setIncludeUnstaged] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState<CommitAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const commitChanges = useMemo(
    () => getCommitChanges(status, includeUnstaged),
    [includeUnstaged, status],
  );
  const hasChanges = commitChanges.length > 0;
  const canCommit =
    hasChanges && Boolean(message.trim()) && !generating && submitting === null;
  const canCommitPush = canCommit && hasPushDestination(status);

  // While generation is on, the message follows the changes. It is only
  // generated while the tab is shown; the message generated after an agent
  // turn is usually already cached.
  useEffect(() => {
    if (!(active && autoGenerateMessage)) {
      setGenerating(false);
      return;
    }

    if (!hasChanges) {
      setMessage("");
      setGenerating(false);
      return;
    }

    const params = {
      changes: commitChanges,
      includeUnstaged,
      model,
      modelSpeed,
      projectPath,
      provider,
      reasoningEffort,
      refreshToken: gitRefreshKey,
    };
    const cachedMessage = getCachedProjectCommitMessage(params);
    if (cachedMessage !== undefined) {
      setMessage(cachedMessage);
      setGenerating(false);
      return;
    }

    let ignore = false;
    setMessage("");
    setError(null);
    setGenerating(true);
    void generateCachedProjectCommitMessage(params)
      .then((nextMessage) => {
        if (!ignore) {
          setMessage(nextMessage);
        }
      })
      .catch(() => {
        if (!ignore) {
          setError(gitT("unableToGenerateCommitMessage"));
        }
      })
      .finally(() => {
        if (!ignore) {
          setGenerating(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [
    active,
    autoGenerateMessage,
    commitChanges,
    gitRefreshKey,
    gitT,
    hasChanges,
    includeUnstaged,
    model,
    modelSpeed,
    projectPath,
    provider,
    reasoningEffort,
  ]);

  const focusMessage = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);
  useCommitMessageFocusRequest(projectId, active, focusMessage);

  const handleAutoGenerateMessageChange = useCallback((checked: boolean) => {
    setAutoGenerateMessage(checked);
    setGenerating(false);
    if (!checked) {
      setMessage("");
    }
  }, []);

  const handleCommit = useCallback(
    async (action: CommitAction) => {
      if (!canCommit || (action === "commit-push" && !canCommitPush)) {
        return;
      }

      setSubmitting(action);
      setError(null);
      try {
        if (action === "commit-push") {
          await apiClient.gitPush({
            commitMessage: message,
            includeUnstaged,
            nextStep: "commit-push",
            projectPath,
          });
        } else {
          await apiClient.gitCommit({
            includeUnstaged,
            message,
            projectPath,
          });
        }
        setMessage("");
      } catch (commitError) {
        setError(
          getApiErrorMessage(
            commitError,
            action === "commit-push"
              ? gitT("unableToCommitAndPush")
              : gitT("unableToCommit"),
          ),
        );
      } finally {
        setSubmitting(null);
        bumpProjectGitRefreshKey(projectId);
      }
    },
    [
      bumpProjectGitRefreshKey,
      canCommit,
      canCommitPush,
      gitT,
      includeUnstaged,
      message,
      projectId,
      projectPath,
    ],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        void handleCommit(event.shiftKey ? "commit-push" : "commit");
      }
    },
    [handleCommit],
  );

  return (
    <div className="space-y-3 border-b border-surface-200 px-3 py-3 dark:border-surface-800">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <label
          className="flex items-center gap-2 text-xs"
          htmlFor={`commit-include-unstaged-${projectId}`}
        >
          <Switch
            checked={includeUnstaged}
            id={`commit-include-unstaged-${projectId}`}
            onCheckedChange={setIncludeUnstaged}
          />
          <span>{gitT("includeUnstaged")}</span>
        </label>
        <label
          className="flex items-center gap-2 text-xs"
          htmlFor={`commit-auto-generate-${projectId}`}
        >
          <Switch
            checked={autoGenerateMessage}
            id={`commit-auto-generate-${projectId}`}
            onCheckedChange={handleAutoGenerateMessageChange}
          />
          <span>{gitT("autoGenerateMessage")}</span>
        </label>
      </div>

      <div className="relative">
        <Textarea
          aria-busy={generating}
          aria-label={gitT("commitMessage")}
          className="max-h-40 min-h-16 resize-none text-sm"
          disabled={submitting !== null}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={generating ? "" : gitT("enterCommitMessage")}
          readOnly={autoGenerateMessage}
          ref={textareaRef}
          value={message}
        />
        {generating ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
            <Shimmer as="span" duration={1.5}>
              {gitT("generatingCommitMessage")}
            </Shimmer>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-destructive text-xs">{error}</p> : null}

      <div className="flex justify-end gap-2">
        <Button
          disabled={!canCommit}
          onClick={() => {
            void handleCommit("commit");
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          {submitting === "commit" ? <Spinner className="size-3.5" /> : null}
          {gitT("commit")}
        </Button>
        <Button
          disabled={!canCommitPush}
          onClick={() => {
            void handleCommit("commit-push");
          }}
          size="sm"
          type="button"
        >
          {submitting === "commit-push" ? (
            <Spinner className="size-3.5" />
          ) : null}
          {gitT("commitAndPush")}
        </Button>
      </div>
    </div>
  );
};

export const GitCommitBox = memo(GitCommitBoxImpl);
GitCommitBox.displayName = "GitCommitBox";
