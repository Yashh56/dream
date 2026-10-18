import assert from "node:assert/strict";
import { test } from "vitest";
import { shouldResumeProviderSession } from "./provider-session.js";
import {
  resolveSessionContext,
  transcriptFingerprint,
} from "./session-context.js";

const message = (id, role, text) => ({
  id,
  role,
  parts: [{ type: "text", text }],
});
const prefix = [
  message("1", "user", "start"),
  message("2", "assistant", "done"),
];
const saved = {
  remoteConversationId: "native",
  remoteConversationProjectPath: "/work",
  lastMessageId: "2",
  fingerprint: transcriptFingerprint(prefix),
};

test("returning to a provider supplies only the missed conversation", () => {
  const result = resolveSessionContext({
    saved,
    projectPath: "/work",
    messages: [
      ...prefix,
      message("3", "user", "change"),
      message("4", "assistant", "changed"),
      message("5", "user", "continue"),
    ],
  });
  assert.equal(result.session.remoteConversationId, "native");
  assert.match(result.handoff.text, /changed/);
  assert.doesNotMatch(result.handoff.text, /continue|user: start/);
});

test("edited, rolled back, oversized and relocated histories reconstruct instead of resuming stale context", () => {
  for (const messages of [
    [prefix[0]],
    [
      prefix[0],
      message("2", "assistant", "edited"),
      message("3", "user", "next"),
    ],
    [
      ...prefix,
      message("3", "assistant", "x".repeat(32_001)),
      message("4", "user", "next"),
    ],
  ]) {
    assert.equal(
      resolveSessionContext({ saved, projectPath: "/work", messages }),
      null,
    );
  }
  assert.equal(
    resolveSessionContext({ saved, projectPath: "/other", messages: prefix }),
    null,
  );
});

test("model and speed changes preserve sessions only on adapters with turn-level model selection", () => {
  const options = {
    ...saved,
    remoteConversationModel: "old",
    remoteConversationModelSpeed: "standard",
    model: "new",
    modelSpeed: "fast",
    projectPath: "/work",
  };
  for (const provider of ["openai", "anthropic", "opencode"])
    assert.equal(shouldResumeProviderSession({ ...options, provider }), true);
  for (const provider of ["cursor", "grok"])
    assert.equal(shouldResumeProviderSession({ ...options, provider }), false);
});

test("provider handoff includes missed tool results and reconstructs missed binary attachments", () => {
  const messages = [
    ...prefix,
    {
      id: "tools",
      role: "assistant",
      parts: [
        {
          type: "tool-readFile",
          toolCallId: "read",
          input: { path: "README.md" },
          output: "Important context",
          state: "output-available",
        },
      ],
    },
    message("latest", "user", "Continue"),
  ];
  assert.match(
    resolveSessionContext({ saved, messages, projectPath: "/work" }).handoff
      .text,
    /Important context/,
  );
  messages[2].parts.push({
    type: "file",
    mediaType: "image/png",
    url: "data:image/png;base64,AA==",
  });
  assert.equal(
    resolveSessionContext({ saved, messages, projectPath: "/work" }),
    null,
  );
});
