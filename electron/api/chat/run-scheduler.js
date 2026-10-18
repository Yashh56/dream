// The host owns dispatch; clients submit durable intent and observe streams.
import { randomUUID } from "node:crypto";
export function createRunScheduler({ catalog, turns, execute }) {
  let ready;
  let closed = false;
  let delegation;
  const workers = new Map();
  const held = new Set();
  const initialize = () =>
    (ready ??= catalog.mutateRunQueue({ type: "recover" }));
  const change = (chatId, id, status, error) =>
    catalog.mutateRunQueue({ type: "status", chatId, id, status, error });

  const drain = (chatId) => {
    if (closed || workers.has(chatId)) return;
    const worker = (async () => {
      await initialize();
      while (!closed && !held.has(chatId) && !turns.isRunning(chatId)) {
        const run = await catalog.mutateRunQueue({ type: "claim", chatId });
        if (!run) return;
        if (closed || held.has(chatId)) {
          await change(
            chatId,
            run.id,
            "interrupted",
            "Stopped before dispatch.",
          );
          return;
        }
        let failure = null;
        let signal;
        let status = "running";
        let scope;
        try {
          const response = await turns.start({
            chatId,
            run: async (abortSignal) => {
              signal = abortSignal;
              scope = delegation?.open(run, signal);
              const chat = await catalog.getChat(chatId);
              if (!chat || chat.deletedAt)
                throw new Error("Chat no longer exists.");
              const messages = JSON.parse(
                await catalog.getTranscriptJson(chatId),
              );
              // An explicitly retried interrupted run already has its user message.
              if (
                !messages.some(
                  (message) => message.id === run.request.message.id,
                )
              )
                messages.push(run.request.message);
              else if (messages.at(-1)?.id !== run.request.message.id)
                messages.push({ ...run.request.message, id: randomUUID() });
              if (
                !(await catalog.saveTranscript(chatId, messages, {
                  origin: "host",
                }))
              )
                throw new Error("Unable to save submission.");
              return execute(
                {
                  ...run.request,
                  chatId,
                  messages,
                  remoteConversationId: chat.remoteConversationId,
                  remoteConversationModel: chat.remoteConversationModel,
                  remoteConversationModelSpeed:
                    chat.remoteConversationModelSpeed,
                  remoteConversationProjectPath:
                    chat.remoteConversationProjectPath,
                },
                {
                  catalog,
                  signal,
                  orchestration: scope,
                  onChunk: async (chunk) => {
                    if (chunk.type === "error")
                      failure = chunk.errorText || "Provider failed.";
                    const next =
                      chunk.type === "tool-approval-request"
                        ? "waiting"
                        : [
                              "tool-output-available",
                              "tool-output-error",
                              "text-delta",
                            ].includes(chunk.type)
                          ? "running"
                          : status;
                    if (status !== next) {
                      status = next;
                      await change(chatId, run.id, status);
                    }
                  },
                },
              );
            },
          });
          if (!response.ok) throw new Error(await response.text());
          const reader = response.body.getReader();
          while (!(await reader.read()).done) {
            /* The registry owns disconnect-independent execution. */
          }
          await change(
            chatId,
            run.id,
            signal?.aborted ? "interrupted" : failure ? "failed" : "completed",
            failure,
          );
          if (failure || signal?.aborted) return;
        } catch (error) {
          await change(
            chatId,
            run.id,
            signal?.aborted ? "interrupted" : "failed",
            error instanceof Error ? error.message : String(error),
          );
          return;
        } finally {
          scope?.close();
        }
      }
    })()
      .catch((error) => console.warn("[queue] Dispatch failed.", error))
      .finally(async () => {
        workers.delete(chatId);
        if (closed || held.has(chatId) || turns.isRunning(chatId)) return;
        // Enqueue can race the last empty claim. Recheck after releasing ownership.
        const queue = await catalog.runQueue(chatId).catch(() => null);
        if (
          queue &&
          !queue.paused &&
          queue.runs.some((run) => run.status === "queued")
        )
          drain(chatId);
      });
    workers.set(chatId, worker);
  };

  return {
    setDelegation(service) {
      delegation = service;
    },
    dispatch: drain,
    initialize,
    async submit(request) {
      if (closed) throw new Error("Host is stopping.");
      await initialize();
      const { requestId: id, chatId, ...payload } = request;
      const receipt = await catalog.mutateRunQueue({
        type: "enqueue",
        chatId,
        id,
        request: payload,
      });
      drain(chatId);
      return receipt;
    },
    async list(chatId) {
      await initialize();
      return catalog.runQueue(chatId);
    },
    async control({ chatId, action, id }) {
      if (action === "pause") held.add(chatId);
      await initialize();
      if (action === "resume") await workers.get(chatId);
      await catalog.mutateRunQueue({ type: action, chatId, id });
      if (action === "pause") {
        turns.stop(chatId);
        for (const child of (await catalog.delegatedTasks?.(chatId)) ?? []) {
          await this.cancelTask(child.childChatId);
        }
      }
      if (action === "resume") held.delete(chatId);
      if (action === "resume" || action === "retry") {
        // A stopped worker may still be settling its transcript/checkpoint.
        await workers.get(chatId);
        drain(chatId);
      }
      return this.list(chatId);
    },
    async cancelTask(chatId) {
      await this.control({ chatId, action: "pause" });
      for (const run of (await this.list(chatId)).runs) {
        if (run.status === "queued")
          await this.control({ chatId, action: "cancel", id: run.id });
      }
    },
    async close() {
      closed = true;
      turns.stopAll();
      await Promise.allSettled(workers.values());
    },
  };
}
