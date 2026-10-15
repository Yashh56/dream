import { GitPullRequest } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { PullRequestSummary } from "./api";

const STATE_STYLES = {
  open: "border-success-border bg-success-surface text-success-foreground",
  merged:
    "border-purple-500/25 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  closed: "border-destructive-border bg-destructive-surface text-destructive",
  draft: "border-border bg-muted text-muted-foreground",
};

/** A pull request's state: open, draft, merged or closed. */
export function PullRequestStatus({ pr }: { pr: PullRequestSummary }) {
  const t = useTranslations();
  const state = pr.state === "open" && pr.draft ? "draft" : pr.state;
  return (
    <Badge variant="outline" className={STATE_STYLES[state]}>
      <GitPullRequest className="size-3" />
      {state === "draft" ? t("git.draft") : t(`pullRequests.${state}`)}
    </Badge>
  );
}
