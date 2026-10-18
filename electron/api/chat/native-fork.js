import { forkSession } from "ai-sdk-provider-claude-code";
import { getCodexAppServerClient } from "./codex-app-server-client.js";
import {
  getCodexAppApprovalPolicy,
  getCodexAppSandboxMode,
} from "./codex-common.js";

export async function forkNativeSession({
  provider,
  source,
  projectPath,
  model,
  modelSpeed,
  permissionMode,
  mcpServers,
}) {
  if (
    source?.provider !== provider ||
    source.remoteConversationProjectPath !== projectPath ||
    !source.remoteConversationId
  )
    return null;
  if (provider === "anthropic" && source.nativeMessageId) {
    const fork = await forkSession(source.remoteConversationId, {
      dir: projectPath,
      upToMessageId: source.nativeMessageId,
    });
    if (!fork.sessionId || fork.sessionId === source.remoteConversationId)
      throw new Error("Provider did not create an independent fork.");
    return fork.sessionId;
  }
  if (provider === "openai" && source.nativeTurnId) {
    const client = await getCodexAppServerClient({ mcpServers });
    const fork = await client.sendRequest("thread/fork", {
      threadId: source.remoteConversationId,
      lastTurnId: source.nativeTurnId,
      cwd: projectPath,
      model,
      serviceTier: modelSpeed === "fast" ? "fast" : null,
      approvalPolicy: getCodexAppApprovalPolicy(permissionMode),
      sandbox: getCodexAppSandboxMode(permissionMode),
      ephemeral: true,
    });
    if (!fork.thread?.id || fork.thread.id === source.remoteConversationId)
      throw new Error("Provider did not create an independent fork.");
    if (fork.thread.turns?.at(-1)?.id !== source.nativeTurnId)
      throw new Error("Provider did not confirm the requested fork boundary.");
    return fork.thread.id;
  }
  return null;
}
