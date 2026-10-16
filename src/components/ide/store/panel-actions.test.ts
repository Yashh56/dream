// Opening a project file from anywhere (a chat chip, a link, search): the
// path is resolved once, the file opens in the project's session, and the
// Files view shows. Nothing is left in the store to be replayed later.
import { expect, test } from "vitest";
import { createStore } from "zustand/vanilla";
import { createFakeApiClient } from "@/lib/api-client-fake";
import { createProjectConfig, DEFAULT_SETTINGS } from "@/lib/ide-defaults";
import { createFileEditorSessions } from "../file-editor-session";
import type { IdeState } from "./ide-store-types";
import { createPanelActions } from "./panel-actions";

const createTestStore = () => {
  const project = createProjectConfig("/work/app", DEFAULT_SETTINGS);
  const fileEditor = createFileEditorSessions({
    api: createFakeApiClient({
      readProjectFile: ({ filePath }) => ({
        content: "",
        filePath,
        lineEnding: "lf",
        readOnlyReason: null,
        writable: true,
      }),
    }).client,
    getProjectPath: () => project.path,
  });
  const store = createStore<IdeState>(
    () => ({ projects: [project] }) as unknown as IdeState,
  );
  store.setState(
    createPanelActions(store.setState, store.getState, { fileEditor }),
  );
  return { fileEditor, project, store };
};

test("an absolute path inside the project opens as its project-relative path, in the Files view", () => {
  const { fileEditor, project, store } = createTestStore();

  const opened = store
    .getState()
    .openProjectFile(project.id, "/work/app/src/a.ts", {
      column: 0,
      length: 1,
      line: 3,
    });

  expect(opened).toBe(true);
  const snapshot = fileEditor.session(project.id).getSnapshot();
  expect(snapshot.tabs).toEqual([{ path: "src/a.ts", pinned: false }]);
  expect(snapshot.reveal).toMatchObject({ line: 3, path: "src/a.ts" });
  expect(store.getState().projects[0]?.ui).toMatchObject({
    rightPanelOpen: true,
    rightPanelView: "explorer",
  });
});

test("the same file named two ways opens one tab", () => {
  const { fileEditor, project, store } = createTestStore();

  store.getState().openProjectFile(project.id, "/work/app/src/a.ts");
  store.getState().openProjectFile(project.id, "./src/a.ts");

  expect(fileEditor.session(project.id).getSnapshot().tabs).toHaveLength(1);
});

test("a path outside the project, or an unknown project, opens nothing", () => {
  const { fileEditor, project, store } = createTestStore();

  expect(store.getState().openProjectFile(project.id, "/elsewhere/a.ts")).toBe(
    false,
  );
  expect(store.getState().openProjectFile("nope", "src/a.ts")).toBe(false);
  expect(fileEditor.session(project.id).getSnapshot().tabs).toEqual([]);
  expect(store.getState().projects[0]?.ui.rightPanelOpen).toBe(
    project.ui.rightPanelOpen,
  );
});
