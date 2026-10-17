import { Code, GitBranch, GitCommitHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useCallback, useEffect } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  AiProvider,
  ModelSpeed,
  ProjectGitStatusResponse,
  ReasoningEffort,
} from "@/types/ide";
import {
  type CommitAction,
  useCommitDraft,
  useCommitDraftErrorText,
} from "./commit-draft";
import { ActionError, DialogMetricRow, GitDialogHeader } from "./dialog-layout";
import { GitChangesDeltaSummary } from "./summary";

/** Commits a worktree's changes, in a dialog (git-actions/commit-draft.ts). */
export const CommitDialog = ({
  branch,
  onCompleted,
  onOpenChange,
  open,
  model,
  modelSpeed,
  projectPath,
  provider,
  reasoningEffort,
  status,
}: {
  branch: string | null;
  onCompleted: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  model: string;
  modelSpeed: ModelSpeed;
  projectPath: string;
  provider: AiProvider;
  reasoningEffort: ReasoningEffort | null;
  status: ProjectGitStatusResponse | null;
}) => {
  const commonT = useTranslations("common");
  const gitT = useTranslations("git");
  const { draft, snapshot } = useCommitDraft({
    canGenerate: open,
    model,
    modelSpeed,
    projectPath,
    provider,
    reasoningEffort,
    status,
  });
  const {
    autoGenerate,
    canCommit,
    canCommitPush,
    changes,
    generating,
    includeUnstaged,
    message,
    submitting,
  } = snapshot;
  const error = useCommitDraftErrorText(snapshot.error);

  // Each opening starts a fresh draft.
  useEffect(() => {
    if (open) {
      draft.reset();
    }
  }, [draft, open]);

  const handleSubmitAction = useCallback(
    async (action: CommitAction) => {
      if (await draft.submit(action)) {
        onCompleted();
        onOpenChange(false);
      }
    },
    [draft, onCompleted, onOpenChange],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      await handleSubmitAction("commit");
    },
    [handleSubmitAction],
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="gap-5 sm:max-w-2xl">
        <GitDialogHeader
          icon={<GitCommitHorizontal />}
          title={gitT("commitTitle")}
        />

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <DialogMetricRow
              icon={<GitBranch className="size-4" />}
              label={commonT("branch")}
              value={
                <span className="truncate">{branch ?? commonT("unknown")}</span>
              }
            />
            <DialogMetricRow
              icon={<Code className="size-4" />}
              label={commonT("changes")}
              value={<GitChangesDeltaSummary changes={changes} />}
            />
          </div>

          <label
            className="flex items-center gap-3 text-sm"
            htmlFor="commit-include-unstaged"
          >
            <Switch
              checked={includeUnstaged}
              id="commit-include-unstaged"
              onCheckedChange={(checked) => draft.setIncludeUnstaged(checked)}
            />
            <span>{gitT("includeUnstaged")}</span>
          </label>

          <label
            className="flex items-center gap-3 text-sm"
            htmlFor="commit-auto-generate-message"
          >
            <Switch
              checked={autoGenerate}
              id="commit-auto-generate-message"
              onCheckedChange={(checked) => draft.setAutoGenerate(checked)}
            />
            <span>{gitT("autoGenerateMessage")}</span>
          </label>

          <div className="space-y-3">
            <label className="font-medium text-sm" htmlFor="commit-message">
              {gitT("commitMessage")}
            </label>
            <div className="relative">
              <Textarea
                aria-busy={generating}
                className="min-h-24 resize-none"
                id="commit-message"
                readOnly={autoGenerate}
                onChange={(event) => draft.setMessage(event.target.value)}
                placeholder={generating ? "" : gitT("enterCommitMessage")}
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
          </div>

          <ActionError error={error} />

          <div className="flex justify-end gap-2">
            <Button
              className="min-w-36"
              disabled={Boolean(submitting) || !canCommit}
              type="submit"
              variant="outline"
            >
              {submitting === "commit" ? <Spinner className="size-4" /> : null}
              <span>{gitT("commit")}</span>
            </Button>
            <Button
              className="min-w-36"
              disabled={Boolean(submitting) || !canCommitPush}
              onClick={() => {
                void handleSubmitAction("commit-push");
              }}
              type="button"
            >
              {submitting === "commit-push" ? (
                <Spinner className="size-4" />
              ) : null}
              <span>{gitT("commitAndPush")}</span>
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
