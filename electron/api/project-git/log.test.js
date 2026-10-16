import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, test, vi } from "vitest";

const { getProjectGitLog } = await import("./actions.js");

vi.setConfig({ testTimeout: 30_000 });

const roots = [];

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const createRepo = () => {
  const root = mkdtempSync(path.join(tmpdir(), "dream-git-log-"));
  roots.push(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
  return root;
};

const commit = (root, name, subject) => {
  writeFileSync(path.join(root, name), subject);
  git(root, "add", name);
  git(root, "commit", "-m", subject);
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test("returns an empty log for a repository without commits", async () => {
  const root = createRepo();

  assert.deepEqual(await getProjectGitLog(root), {
    commits: [],
    hasMore: false,
  });
});

test("lists commits newest first with refs and paging", async () => {
  const root = createRepo();
  commit(root, "a.txt", "First commit");
  commit(root, "b.txt", "Second, with a comma");
  commit(root, "c.txt", "Third commit");
  git(root, "tag", "v1");

  const firstPage = await getProjectGitLog(root, { limit: 2 });
  assert.equal(firstPage.hasMore, true);
  assert.deepEqual(
    firstPage.commits.map((item) => item.subject),
    ["Third commit", "Second, with a comma"],
  );
  assert.deepEqual(firstPage.commits[0].refs, ["main", "tag: v1"]);
  assert.equal(firstPage.commits[0].authorName, "Test");
  assert.equal(firstPage.commits[0].authorEmail, "test@example.com");
  assert.equal(firstPage.commits[0].hash.length, 40);
  assert.ok(
    firstPage.commits[0].hash.startsWith(firstPage.commits[0].shortHash),
  );
  assert.ok(!Number.isNaN(Date.parse(firstPage.commits[0].authorDate)));
  assert.deepEqual(firstPage.commits[1].refs, []);

  const secondPage = await getProjectGitLog(root, { limit: 2, skip: 2 });
  assert.equal(secondPage.hasMore, false);
  assert.deepEqual(
    secondPage.commits.map((item) => item.subject),
    ["First commit"],
  );
});

test("names each commit's parents, a merge's first parent first", async () => {
  const root = createRepo();
  commit(root, "a.txt", "Base");
  git(root, "checkout", "-b", "feature");
  commit(root, "f.txt", "Feature work");
  git(root, "checkout", "main");
  commit(root, "m.txt", "Main work");
  git(root, "merge", "--no-ff", "-m", "Merge feature", "feature");

  const { commits } = await getProjectGitLog(root);
  const bySubject = Object.fromEntries(
    commits.map((item) => [item.subject, item]),
  );

  assert.equal(commits[0].subject, "Merge feature");
  assert.deepEqual(bySubject["Merge feature"].parents, [
    bySubject["Main work"].hash,
    bySubject["Feature work"].hash,
  ]);
  assert.deepEqual(bySubject["Feature work"].parents, [bySubject.Base.hash]);
  assert.deepEqual(bySubject.Base.parents, []);
  // Every commit comes before its parents.
  const position = new Map(commits.map((item, index) => [item.hash, index]));
  for (const item of commits) {
    for (const parent of item.parents) {
      assert.ok(position.get(parent) > position.get(item.hash));
    }
  }
});
