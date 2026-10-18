import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  controlChatQueue,
  refreshChatQueue,
  useChatQueueStore,
} from "@/lib/chat-queue";

export function ChatQueue({ chatId }: { chatId: string }) {
  const t = useTranslations("chat");
  const queue = useChatQueueStore((state) => state.queues[chatId]);
  const error = useChatQueueStore((state) => state.errors[chatId]);
  useEffect(() => {
    void refreshChatQueue(chatId);
  }, [chatId]);
  const runs =
    queue?.runs.filter(
      (run) => run.status !== "completed" && run.status !== "cancelled",
    ) ?? [];
  if (!runs.length && !error) return null;
  return (
    <div className="mx-3 mb-2 rounded-md border p-2 text-sm" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <span>{t(queue?.paused ? "queuePaused" : "queueTitle")}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void controlChatQueue({
              chatId,
              action: queue?.paused ? "resume" : "pause",
            })
          }
        >
          {t(queue?.paused ? "queueResume" : "queuePause")}
        </Button>
      </div>
      {error ? (
        <p className="text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <ol className="max-h-40 overflow-y-auto">
        {runs.map((run) => (
          <li key={run.id} className="mt-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate">{run.text || t("queueAttachment")}</p>
              <p className="text-xs text-muted-foreground">
                {run.model} ·{" "}
                {run.status !== "completed" && run.status !== "cancelled"
                  ? t(`queueStatus.${run.status}`)
                  : null}
              </p>
              {run.error ? (
                <p className="text-xs text-destructive">{run.error}</p>
              ) : null}
            </div>
            {run.status === "queued" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void controlChatQueue({
                    chatId,
                    action: "cancel",
                    id: run.id,
                  })
                }
              >
                {t("queueCancel")}
              </Button>
            ) : null}
            {["failed", "interrupted"].includes(run.status) ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void controlChatQueue({ chatId, action: "retry", id: run.id })
                }
              >
                {t("queueRetry")}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
