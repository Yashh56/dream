// Pending tool approvals: a turn asks the user through the agent-turn writer
// and waits here; the client answers through the route below.
import { z } from "zod";
import { handleJsonRoute } from "./shared/json-route.js";

const pendingToolApprovals = new Map();

const registerPendingToolApproval = ({ id, provider, request, respond }) => {
  pendingToolApprovals.set(id, { provider, request, respond });
};

export const toolApprovalResponseSchema = z.object({
  chatId: z.string().min(1).optional(),
  approved: z.boolean(),
  id: z.string().min(1),
  reason: z.string().nullable().optional(),
  scope: z.enum(["once", "session"]).default("once"),
});

export const waitForToolApproval = ({ id, provider, request, signal }) =>
  new Promise((resolve) => {
    let settled = false;

    const finish = (response) => {
      if (settled) {
        return;
      }

      settled = true;
      signal?.removeEventListener("abort", handleAbort);
      pendingToolApprovals.delete(id);
      resolve(response);
    };

    const handleAbort = () => {
      finish({
        approved: false,
        id,
        reason: "Permission request was cancelled.",
        scope: "once",
      });
    };

    registerPendingToolApproval({
      id,
      provider,
      request,
      respond: finish,
    });

    if (signal?.aborted) {
      handleAbort();
      return;
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
  });

/**
 * Answers a pending approval. Returns what the route reports: whether an
 * approval with that id was waiting, and which provider owned it.
 */
export const resolveToolApproval = async (payload) => {
  const pendingApproval = pendingToolApprovals.get(payload.id);
  if (!pendingApproval) {
    // A saved approval can outlive its provider callback after a restart.
    // Never tell the renderer that an expired callback was accepted.
    return { handled: false, status: "not-found" };
  }

  pendingToolApprovals.delete(payload.id);
  await pendingApproval.respond(payload);
  return { handled: true, provider: pendingApproval.provider, status: "ok" };
};

export const registerToolApprovalRoutes = (app) => {
  app.post("/api/tool-approval-response", (c) =>
    handleJsonRoute(c, toolApprovalResponseSchema, resolveToolApproval, {
      errorMessage: "Failed to resolve approval.",
      errorStatus: 500,
    }),
  );
};
