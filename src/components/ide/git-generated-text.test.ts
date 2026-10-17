// Generated git text over a mocked Route client: one request per set of
// changes and settings, shared while under way, kept only when it has text,
// and failures handed to the caller rather than hidden.
import { afterEach, expect, test, vi } from "vitest";
import type { ProjectGitStatusEntry } from "@/types/ide";

const api = vi.hoisted(() => ({
  gitCommitMessage: vi.fn(),
  gitPullRequestDetails: vi.fn(),
}));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, apiClient: { ...actual.apiClient, ...api } };
});

const {
  cachedCommitMessage,
  cachedPullRequestDetails,
  clearGeneratedGitText,
  generateCommitMessage,
  generatePullRequestDetails,
} = await import("./git-generated-text");

afterEach(() => {
  clearGeneratedGitText();
  api.gitCommitMessage.mockReset();
  api.gitPullRequestDetails.mockReset();
});

const change = (path: string): ProjectGitStatusEntry => ({
  addedLines: 1,
  path,
  previousPath: null,
  removedLines: 0,
  staged: false,
  status: "modified",
  unstaged: true,
});

const commitRequest = (model = "gpt-5-codex") => ({
  changes: [change("b.ts"), change("a.ts")],
  includeUnstaged: true,
  model,
  modelSpeed: "standard" as const,
  projectPath: "/work/app",
  provider: "openai" as const,
  reasoningEffort: null,
});

const prRequest = () => ({
  ...commitRequest(),
  baseBranch: "main",
  branch: "feature",
  nextStep: "create" as const,
  version: 3,
});

test("one request per set of changes, shared while under way, kept after", async () => {
  api.gitCommitMessage.mockResolvedValue({ commitMessage: "  Fix a and b " });

  const [first, second] = await Promise.all([
    generateCommitMessage(commitRequest()),
    generateCommitMessage(commitRequest()),
  ]);

  expect(first).toBe("Fix a and b");
  expect(second).toBe("Fix a and b");
  expect(api.gitCommitMessage).toHaveBeenCalledTimes(1);
  // The same changes in another order are the same changes.
  expect(
    cachedCommitMessage({
      ...commitRequest(),
      changes: [change("a.ts"), change("b.ts")],
    }),
  ).toBe("Fix a and b");
});

test("another model asks again", async () => {
  api.gitCommitMessage.mockResolvedValue({ commitMessage: "Fix" });
  await generateCommitMessage(commitRequest("gpt-5-codex"));

  expect(cachedCommitMessage(commitRequest("claude-sonnet"))).toBeUndefined();
  await generateCommitMessage(commitRequest("claude-sonnet"));
  expect(api.gitCommitMessage).toHaveBeenCalledTimes(2);
});

test("an empty answer is not kept", async () => {
  api.gitCommitMessage.mockResolvedValue({ commitMessage: "   " });
  await expect(generateCommitMessage(commitRequest())).resolves.toBe("");
  expect(cachedCommitMessage(commitRequest())).toBeUndefined();
});

test("a pull request details failure reaches the caller and is not kept", async () => {
  api.gitPullRequestDetails.mockRejectedValueOnce(new Error("no base branch"));

  await expect(generatePullRequestDetails(prRequest())).rejects.toThrow(
    "no base branch",
  );
  expect(cachedPullRequestDetails(prRequest())).toBeUndefined();

  api.gitPullRequestDetails.mockResolvedValueOnce({
    baseBranch: "main",
    commitMessage: null,
    description: "Body",
    headBranch: "feature",
    title: "Title",
  });
  await expect(generatePullRequestDetails(prRequest())).resolves.toMatchObject({
    title: "Title",
  });
  expect(cachedPullRequestDetails(prRequest())?.title).toBe("Title");
});

test("pull request details are per git version", async () => {
  api.gitPullRequestDetails.mockResolvedValue({
    baseBranch: "main",
    commitMessage: null,
    description: "Body",
    headBranch: "feature",
    title: "Title",
  });
  await generatePullRequestDetails(prRequest());

  expect(
    cachedPullRequestDetails({ ...prRequest(), version: 4 }),
  ).toBeUndefined();
});
