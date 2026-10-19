import { create } from "zustand";
import {
  apiClient,
  type ChatQueueResponse,
  type ChatRunSummary,
} from "./api-client";

type FinishedRunStatus = "completed" | "cancelled";
export type OpenChatRun = ChatRunSummary & {
  status: Exclude<ChatRunSummary["status"], FinishedRunStatus>;
};

const isOpenRun = (run: ChatRunSummary): run is OpenChatRun =>
  run.status !== "completed" && run.status !== "cancelled";
// The turn in progress (or waiting on a tool approval): the transcript
// already shows it.
const LIVE_RUN_STATUSES = new Set(["running", "waiting"]);

/**
 * The runs the queue panel lists: none unless one needs attention (queued
 * behind the current turn, interrupted or failed). The live turn alone is not
 * a queue; alongside waiting runs it is listed first, as context.
 */
export function visibleQueueRuns(
  runs: readonly ChatRunSummary[],
): OpenChatRun[] {
  const open = runs.filter(isOpenRun);
  return open.some((run) => !LIVE_RUN_STATUSES.has(run.status)) ? open : [];
}

export const useChatQueueStore = create<{
  queues: Record<string, ChatQueueResponse>;
  errors: Record<string, string | undefined>;
}>(() => ({ queues: {}, errors: {} }));

const revisions = new Map<string, object>();
export function forgetChatQueue(chatId: string) {
  revisions.delete(chatId);
  useChatQueueStore.setState((state) => {
    const queues = { ...state.queues };
    const errors = { ...state.errors };
    delete queues[chatId];
    delete errors[chatId];
    return { queues, errors };
  });
}
export async function refreshChatQueue(chatId: string) {
  const revision = {};
  revisions.set(chatId, revision);
  try {
    const queue = await apiClient.chatQueue({ chatId });
    if (revisions.get(chatId) !== revision) return;
    useChatQueueStore.setState((state) => ({
      queues: { ...state.queues, [chatId]: queue },
      errors: { ...state.errors, [chatId]: undefined },
    }));
  } catch (error) {
    if (revisions.get(chatId) !== revision) return;
    useChatQueueStore.setState((state) => ({
      errors: {
        ...state.errors,
        [chatId]: error instanceof Error ? error.message : String(error),
      },
    }));
  } finally {
    if (revisions.get(chatId) === revision) revisions.delete(chatId);
  }
}

export async function controlChatQueue(
  input: Parameters<typeof apiClient.controlChatQueue>[0],
) {
  try {
    await apiClient.controlChatQueue(input);
    await refreshChatQueue(input.chatId);
  } catch (error) {
    useChatQueueStore.setState((state) => ({
      errors: {
        ...state.errors,
        [input.chatId]: error instanceof Error ? error.message : String(error),
      },
    }));
  }
}
