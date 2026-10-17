import assert from "node:assert/strict";
import { describe, test } from "vitest";
import {
  ALL_PROVIDERS,
  decodeSelectedModels,
  getConnectedProviders,
  getDefaultModelForProvider,
  getProviderForModel,
  getSelectedModels,
  normalizeProvider,
  settleModelSelection,
  withSelectedModels,
} from "./model-selection.js";
import { DEFAULT_SETTINGS } from "./persisted-state-codec.js";
import { PROVIDER_CAPABILITIES } from "./provider-capabilities.js";

/** Settings where each named provider has picked `models`. */
const settingsPicking = (picks, overrides = {}) => {
  let settings = { ...DEFAULT_SETTINGS, ...overrides };
  for (const [provider, models] of Object.entries(picks)) {
    settings = withSelectedModels(settings, provider, models);
  }
  return settings;
};

const project = (id, provider, model) => ({ id, model, provider });
const chat = (id, projectId, provider, model) => ({
  id,
  model,
  projectId,
  provider,
});

describe.each(ALL_PROVIDERS)("provider %s", (provider) => {
  const key = PROVIDER_CAPABILITIES[provider].selectedModelsSetting;
  // A model id this provider keeps as written.
  const model = provider === "anthropic" ? "sonnet" : `${provider}-model`;

  test("its picked models live in its own setting", () => {
    const settings = withSelectedModels(DEFAULT_SETTINGS, provider, [
      model,
      ` ${model} `,
    ]);
    assert.deepEqual(settings[key], [model, ` ${model} `]);
    assert.deepEqual(getSelectedModels(provider, settings), [model]);
    assert.deepEqual(decodeSelectedModels({ [key]: [model, 7, model] })[key], [
      model,
    ]);
    for (const other of ALL_PROVIDERS.filter((item) => item !== provider)) {
      assert.deepEqual(getSelectedModels(other, settings), []);
    }
  });

  test("it is a provider id, connected once it picks a model", () => {
    assert.equal(normalizeProvider(provider), provider);
    const settings = settingsPicking({ [provider]: [model] });
    assert.deepEqual(getConnectedProviders(settings), [provider]);
    assert.equal(getProviderForModel(model, settings), provider);
    assert.deepEqual(
      getConnectedProviders({ ...settings, disabledProviders: [provider] }),
      [],
    );
  });

  test("a project on a model it no longer offers moves to its fallback", () => {
    const settings = settingsPicking({ [provider]: [model, `${model}-2`] });
    const projects = [project("p", provider, "retired-model")];
    const settled = settleModelSelection({ chats: [], projects, settings });
    assert.equal(settled.projects[0].provider, provider);
    assert.equal(
      settled.projects[0].model,
      getDefaultModelForProvider(provider, settled.settings),
    );
  });

  test("a project on it moves to the default selection once it is disabled", () => {
    const other = ALL_PROVIDERS.find((item) => item !== provider);
    const settings = settingsPicking(
      { [other]: ["other-model"], [provider]: [model] },
      { disabledProviders: [provider] },
    );
    const settled = settleModelSelection({
      chats: [chat("c", "p", provider, model)],
      projects: [project("p", provider, model)],
      settings,
    });
    assert.deepEqual(
      [settled.projects[0].provider, settled.projects[0].model],
      [other, "other-model"],
    );
    assert.deepEqual(
      [settled.chats[0].provider, settled.chats[0].model],
      [other, "other-model"],
    );
  });
});

describe("settleModelSelection", () => {
  test("normalizes picked models and points the defaults at one", () => {
    const settings = settingsPicking(
      { anthropic: ["Opus", "opus", "claude-sonnet[1m]"], openai: ["gpt", ""] },
      { defaultModel: "retired" },
    );
    const settled = settleModelSelection({ chats: [], projects: [], settings });
    assert.deepEqual(settled.settings.anthropicSelectedModels, [
      "opus",
      "claude-sonnet[1m]",
    ]);
    assert.deepEqual(settled.settings.openAiSelectedModels, ["gpt"]);
    assert.equal(settled.settings.defaultModel, "gpt");
  });

  test("answers what needs no change as the same objects", () => {
    const settings = settleModelSelection({
      chats: [],
      projects: [],
      settings: settingsPicking({ openai: ["gpt"] }),
    }).settings;
    const state = {
      chats: [chat("c", "p", "openai", "gpt")],
      projects: [project("p", "openai", "gpt")],
      settings,
    };
    const settled = settleModelSelection(state);
    assert.equal(settled.settings, state.settings);
    assert.equal(settled.projects, state.projects);
    assert.equal(settled.chats, state.chats);
  });

  test("keeps the unchanged items and leaves chats of projects not open", () => {
    const settings = settingsPicking({ openai: ["gpt"] });
    const kept = project("kept", "openai", "gpt");
    const closedChat = chat("closed", "closed-project", "openai", "retired");
    const settled = settleModelSelection({
      chats: [closedChat, chat("open", "moved", "openai", "retired")],
      projects: [kept, project("moved", "openai", "retired")],
      settings,
    });
    assert.equal(settled.projects[0], kept);
    assert.equal(settled.projects[1].model, "gpt");
    assert.equal(settled.chats[0], closedChat);
    assert.equal(settled.chats[1].model, "gpt");
  });
});
