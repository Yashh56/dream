import { GitBranch, GitCommitHorizontal, GitMerge } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { ProjectScope } from "@/lib/project-resource-cache";
import { NextStepSelector } from "../git-actions/dialog-layout";
import {
  type PullRequestSummary,
  usePullRequestRead,
  writePullRequest,
} from "./api";

type MergeMethod = "merge" | "squash" | "rebase";
type MergeInfo = PullRequestSummary & {
  head: string;
  base: string;
  canMerge: boolean;
  methods: MergeMethod[];
};

export function MergePrDialog({
  scope,
  repository,
  number,
  onClose,
}: {
  scope: ProjectScope;
  repository: string;
  number: number;
  onClose: () => void;
}) {
  const t = useTranslations();
  const resource = usePullRequestRead<MergeInfo>(scope, {
    action: "mergeInfo",
    repository,
    number,
  });
  const info = resource.error === undefined ? (resource.data ?? null) : null;
  const [method, setMethod] = useState<MergeMethod>("merge");
  const loading = resource.loading || resource.version === null;
  const [merging, setMerging] = useState(false);
  const [writeError, setError] = useState<string | null>(null);
  const error =
    writeError ??
    (resource.error === undefined
      ? null
      : resource.error instanceof Error
        ? resource.error.message
        : t("pullRequests.loadMergeFailed"));
  // biome-ignore lint/correctness/useExhaustiveDependencies: on opening, refresh a previous result, but share a first load already under way.
  useEffect(() => {
    if (resource.version !== null)
      void resource.refresh().catch(() => undefined);
  }, [resource.refresh]);
  useEffect(() => {
    if (info)
      setMethod((current) =>
        info.methods.includes(current) ? current : (info.methods[0] ?? "merge"),
      );
  }, [info]);

  const blocked =
    info &&
    (info.state !== "open"
      ? t("pullRequests.noLongerOpen")
      : info.draft
        ? t("pullRequests.markReady")
        : !info.canMerge
          ? t("pullRequests.mergeForbidden")
          : !info.methods.length
            ? t("pullRequests.noMergeMethods")
            : null);
  const merge = async () => {
    if (!info?.commit || loading || merging || blocked) return;
    setMerging(true);
    setError(null);
    try {
      await writePullRequest(scope, {
        action: "merge",
        repository,
        number,
        commit: info.commit,
        mergeMethod: method,
      });
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : t("pullRequests.mergeFailed"),
      );
    } finally {
      setMerging(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !merging) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <GitMerge className="size-4" />
            {t("pullRequests.mergeTitle", { number })}
          </DialogTitle>
          <DialogDescription>
            {info?.title ?? t("pullRequests.mergeDescription")}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex min-h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : info ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <GitBranch className="size-3.5 shrink-0" />
              <span className="break-all">
                {info.head} → {info.base}
              </span>
            </div>
            <NextStepSelector<MergeMethod>
              idPrefix="merge-pr-method"
              value={method}
              onValueChange={setMethod}
              options={[
                {
                  value: "merge",
                  label: t("pullRequests.mergeCommit"),
                  icon: <GitMerge />,
                },
                {
                  value: "squash",
                  label: t("pullRequests.squashMerge"),
                  icon: <GitCommitHorizontal />,
                },
                {
                  value: "rebase",
                  label: t("pullRequests.rebaseMerge"),
                  icon: <GitBranch />,
                },
              ].map((option) => ({
                ...option,
                value: option.value as MergeMethod,
                disabled:
                  merging ||
                  !info.methods.includes(option.value as MergeMethod),
              }))}
            />
          </div>
        ) : null}
        {blocked || error ? (
          <p
            role="alert"
            className="text-xs text-destructive whitespace-pre-wrap"
          >
            {error ?? blocked}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            size="sm"
            variant="ghost"
            disabled={merging}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          {error ? (
            <Button
              size="sm"
              variant="outline"
              disabled={loading || merging}
              onClick={() => {
                setError(null);
                void resource.refresh().catch(() => undefined);
              }}
            >
              {t("common.refresh")}
            </Button>
          ) : null}
          <Button
            size="sm"
            disabled={loading || merging || !info?.commit || Boolean(blocked)}
            onClick={merge}
          >
            {merging ? (
              <Spinner className="size-3.5" />
            ) : (
              <GitMerge className="size-3.5" />
            )}
            {merging ? t("pullRequests.merging") : t("pullRequests.mergePr")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
