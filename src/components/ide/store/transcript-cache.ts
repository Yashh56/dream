import type { UIMessage } from "ai";
import { areMessagesEqual } from "./helpers";
import {
  loadPersistedChatMessages,
  savePersistedChatMessages,
} from "./ide-store-persistence";
import type { IdeState } from "./ide-store-types";

// Soft limits: live consumers and unsaved messages always take precedence.
const MAX_TRANSCRIPTS = 12;
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

interface Entry {
  messages: UIMessage[];
  bytes: number;
  used: number;
  persisted: boolean;
}

interface PendingLoad {
  promise: Promise<UIMessage[]>;
  refreshRequested: boolean;
}

export const createTranscriptCache = (
  get: () => IdeState,
  set: (state: Partial<IdeState>) => void,
) => {
  const entries = new Map<string, Entry>();
  const messageSizes = new WeakMap<UIMessage, number>();
  const mounted = new Map<string, number>();
  const loads = new Map<string, PendingLoad>();
  const saves = new Map<string, Promise<void>>();
  let clock = 0;
  let pruneScheduled = false;

  const estimateBytes = (messages: UIMessage[]) => {
    let bytes = 0;
    for (const message of messages) {
      let size = messageSizes.get(message);
      if (size === undefined) {
        size = JSON.stringify(message).length * 2;
        messageSizes.set(message, size);
      }
      bytes += size;
    }
    return bytes;
  };

  const protectedChat = (id: string, state: IdeState) =>
    mounted.has(id) ||
    state.streamingChatIds[id] ||
    state.awaitingAnswerChatIds[id] ||
    state.pendingChatSubmitByChatId[id];

  const canLoad = (id: string, state: IdeState) => {
    const chat = state.chats.find((chat) => chat.id === id);
    return (
      chat !== undefined &&
      chat.deletedAt === null &&
      !state.streamingChatIds[id] &&
      (state.projects.some((project) => project.id === chat.projectId) ||
        protectedChat(id, state))
    );
  };

  const prune = () => {
    const state = get();
    const openProjects = new Set(state.projects.map((project) => project.id));
    const chats = new Map(state.chats.map((chat) => [chat.id, chat]));
    const closed = (id: string) => {
      const chat = chats.get(id);
      return (
        !chat || chat.deletedAt !== null || !openProjects.has(chat.projectId)
      );
    };
    // Invalidate abandoned loads by identity. A later reopen starts a new load,
    // and completion/finally from the old request cannot replace or clear it.
    for (const id of loads.keys()) {
      if (closed(id) && !protectedChat(id, state)) loads.delete(id);
    }
    let count = entries.size;
    let bytes = 0;
    for (const entry of entries.values()) bytes += entry.bytes;
    let messagesByChatId = state.messagesByChatId;
    for (const [id, entry] of [...entries].sort(
      (a, b) => a[1].used - b[1].used,
    )) {
      if (
        protectedChat(id, state) ||
        !entry.persisted ||
        saves.has(id) ||
        (!closed(id) &&
          count <= MAX_TRANSCRIPTS &&
          bytes <= MAX_TRANSCRIPT_BYTES)
      )
        continue;
      if (messagesByChatId === state.messagesByChatId) {
        messagesByChatId = { ...messagesByChatId };
      }
      delete messagesByChatId[id];
      entries.delete(id);
      loads.delete(id);
      count--;
      bytes -= entry.bytes;
    }
    if (messagesByChatId !== state.messagesByChatId) set({ messagesByChatId });
  };

  const schedulePrune = () => {
    if (pruneScheduled) return;
    pruneScheduled = true;
    // Let all React unmount cleanups flush their latest messages first.
    queueMicrotask(() => {
      pruneScheduled = false;
      prune();
    });
  };

  const observe = (state: IdeState, previous: IdeState) => {
    if (
      state.chats !== previous.chats ||
      state.projects !== previous.projects ||
      state.streamingChatIds !== previous.streamingChatIds
    ) {
      // Invalidate immediately: a close/reopen or start/stop in the same tick
      // must not make an abandoned request current again.
      for (const id of loads.keys()) {
        if (!canLoad(id, state)) loads.delete(id);
      }
    }
    if (
      state.activeProjectId !== previous.activeProjectId ||
      state.projects !== previous.projects
    ) {
      const activeChatId = state.getActiveProject()?.ui.activeChatId;
      const previousChatId = previous.projects.find(
        (project) => project.id === previous.activeProjectId,
      )?.ui.activeChatId;
      if (activeChatId && activeChatId !== previousChatId) {
        const entry = entries.get(activeChatId);
        if (entry) entry.used = ++clock;
      }
    }
    if (state.messagesByChatId !== previous.messagesByChatId) {
      for (const id of entries.keys()) {
        if (!Object.hasOwn(state.messagesByChatId, id)) {
          entries.delete(id);
          loads.delete(id);
        }
      }
      for (const [id, messages] of Object.entries(state.messagesByChatId)) {
        if (entries.get(id)?.messages === messages) continue;
        entries.set(id, {
          messages,
          // Approximate UTF-16 payload size, not a claim about total JS heap.
          bytes: estimateBytes(messages),
          used: ++clock,
          persisted: false,
        });
      }
    }
    if (
      state.messagesByChatId !== previous.messagesByChatId ||
      state.projects !== previous.projects ||
      state.chats !== previous.chats ||
      state.streamingChatIds !== previous.streamingChatIds ||
      state.awaitingAnswerChatIds !== previous.awaitingAnswerChatIds ||
      state.pendingChatSubmitByChatId !== previous.pendingChatSubmitByChatId
    )
      schedulePrune();
  };

  const load = (id: string): Promise<UIMessage[]> => {
    const pending = loads.get(id);
    if (pending) return pending.promise;

    let request: PendingLoad;
    // Install request identity before reading, including synchronous bursts
    // of catalog notifications. All callers await the latest requested read.
    const promise = Promise.resolve()
      .then(async () => {
        while (loads.get(id) === request && canLoad(id, get())) {
          request.refreshRequested = false;
          const previousMessages = get().messagesByChatId[id];
          let messages: UIMessage[];
          try {
            messages = await loadPersistedChatMessages(id);
          } catch (error) {
            // A newer notification still deserves its read if this one failed.
            if (loads.get(id) === request && request.refreshRequested) continue;
            throw error;
          }
          if (loads.get(id) !== request || !canLoad(id, get())) break;
          // One trailing read covers every notification during this read;
          // its older snapshot never enters the store.
          if (request.refreshRequested) continue;

          const state = get();
          // Local edits made while reading own the transcript now.
          if (state.messagesByChatId[id] !== previousMessages) break;
          // A notification triggered while publishing starts a new read;
          // it must not join this request after its final freshness check.
          loads.delete(id);
          if (previousMessages === undefined) {
            set({
              chats: state.chats.map((chat) =>
                chat.id === id
                  ? { ...chat, messageCount: messages.length }
                  : chat,
              ),
              messagesByChatId: { ...state.messagesByChatId, [id]: messages },
            });
          } else {
            // Preserve the same history/answer merging used by local updates.
            state.setMessagesForChat(id, messages);
          }
          const retained = get().messagesByChatId[id];
          const entry = entries.get(id);
          if (entry && entry.messages === retained) {
            // A merge may retain local answers absent from the host snapshot.
            entry.persisted = areMessagesEqual(retained, messages);
          }
          schedulePrune();
          return retained ?? messages;
        }
        return get().messagesByChatId[id] ?? [];
      })
      .finally(() => {
        if (loads.get(id) === request) loads.delete(id);
      });
    request = { promise, refreshRequested: false };
    loads.set(id, request);
    return promise;
  };

  const actions: Pick<
    IdeState,
    | "retainChatTranscript"
    | "loadMessagesForChat"
    | "applyCatalogTranscript"
    | "persistMessagesForChat"
  > = {
    retainChatTranscript: (id) => {
      mounted.set(id, (mounted.get(id) ?? 0) + 1);
      const entry = entries.get(id);
      if (entry) entry.used = ++clock;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const count = (mounted.get(id) ?? 1) - 1;
        if (count) mounted.set(id, count);
        else mounted.delete(id);
        schedulePrune();
      };
    },
    loadMessagesForChat: async (id) => {
      const existing = get().messagesByChatId[id];
      if (existing) {
        const entry = entries.get(id);
        if (entry) entry.used = ++clock;
        return existing;
      }
      return load(id);
    },
    applyCatalogTranscript: async (id) => {
      const state = get();
      if (!canLoad(id, state)) return;
      const pending = loads.get(id);
      // Stay lazy, but don't lose a notification during the initial load.
      if (!pending && !Object.hasOwn(state.messagesByChatId, id)) return;
      if (pending) pending.refreshRequested = true;
      try {
        await load(id);
      } catch {
        // Keep the current messages. The next notification retries the read.
      }
    },
    persistMessagesForChat: async (id, messages) => {
      if (messages) get().setMessagesForChat(id, messages);
      const snapshot = get().messagesByChatId[id];
      if (!snapshot) return;
      const entry = entries.get(id);
      // Serialize writes per chat so a slow older save cannot overwrite a newer
      // transcript on disk. Failed saves leave the entry dirty and protected.
      const previous = saves.get(id) ?? Promise.resolve();
      const promise = previous
        .then(async () => {
          if (!get().chats.some((chat) => chat.id === id)) return;
          get().persist();
          await savePersistedChatMessages(id, snapshot);
          if (
            entry &&
            entries.get(id) === entry &&
            entry.messages === snapshot
          ) {
            entry.persisted = true;
          }
        })
        .catch((error: unknown) => {
          console.warn(`Unable to persist messages for chat ${id}.`, error);
        })
        .finally(() => {
          if (saves.get(id) === promise) saves.delete(id);
          schedulePrune();
        });
      saves.set(id, promise);
      await promise;
    },
  };

  const markHydrated = (messagesByChatId: Record<string, UIMessage[]>) => {
    for (const [id, messages] of Object.entries(messagesByChatId)) {
      const entry = entries.get(id);
      if (entry?.messages === messages) entry.persisted = true;
    }
    schedulePrune();
  };

  return { actions, observe, markHydrated };
};
