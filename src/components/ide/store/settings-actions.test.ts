// Writing settings settles the models in use (settleModelSelection): an open
// project or chat whose model the new settings no longer offer moves, at the
// write itself rather than in an effect afterwards.
import { expect, test } from "vitest";
import { createStore } from "zustand/vanilla";
import {
  createChatConfig,
  createProjectConfig,
  DEFAULT_SETTINGS,
  withSelectedModels,
} from "@/lib/ide-defaults";
import type { IdeState } from "./ide-store-types";
import { createSettingsActions } from "./settings-actions";

const createTestStore = () => {
  const settings = withSelectedModels(
    withSelectedModels(DEFAULT_SETTINGS, "openai", ["gpt-a", "gpt-b"]),
    "anthropic",
    ["opus"],
  );
  const project = {
    ...createProjectConfig("/work/app", settings),
    model: "gpt-b",
    provider: "openai" as const,
  };
  const chat = {
    ...createChatConfig(project, { title: "Chat" }),
    model: "gpt-b",
    provider: "openai" as const,
  };
  const store = createStore<IdeState>(
    () =>
      ({
        chats: [chat],
        closedProjects: [],
        projects: [project],
        settings,
      }) as unknown as IdeState,
  );
  store.setState(createSettingsActions(store.setState, store.getState));
  return { chat, project, store };
};

test("unpicking a model moves the projects and chats on it", () => {
  const { store } = createTestStore();

  store.getState().toggleProviderModel("openai", "gpt-b", false);

  const state = store.getState();
  expect(state.settings.openAiSelectedModels).toEqual(["gpt-a"]);
  expect(state.projects[0].model).toBe("gpt-a");
  expect(state.chats[0].model).toBe("gpt-a");
});

test("disabling a provider moves its projects and chats to the default", () => {
  const { store } = createTestStore();

  store.getState().setSettings((settings) => ({
    ...settings,
    disabledProviders: ["openai"],
  }));

  const state = store.getState();
  expect([state.projects[0].provider, state.projects[0].model]).toEqual([
    "anthropic",
    "opus",
  ]);
  expect([state.chats[0].provider, state.chats[0].model]).toEqual([
    "anthropic",
    "opus",
  ]);
});

test("a settings change that offers the same models moves nothing", () => {
  const { chat, project, store } = createTestStore();

  store.getState().setSettings((settings) => ({
    ...settings,
    expandToolCalls: !settings.expandToolCalls,
  }));

  expect(store.getState().projects[0]).toBe(project);
  expect(store.getState().chats[0]).toBe(chat);
});
