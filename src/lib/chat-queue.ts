import { create } from "zustand";
import { apiClient, type ChatQueueResponse } from "./api-client";

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
