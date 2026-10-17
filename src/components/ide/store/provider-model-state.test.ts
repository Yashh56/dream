import { describe, expect, test } from "vitest";
import {
  ALL_PROVIDERS,
  DEFAULT_SETTINGS,
  getSelectedModels,
  withSelectedModels,
} from "@/lib/ide-defaults";
import { createModelOption } from "@/lib/models";
import type { AiProvider } from "@/types/ide";
import type { ProviderModelState } from "../ide-types";
import {
  DEFAULT_PROVIDER_MODELS,
  getProviderModelsErrorState,
  getProviderModelsFromResponse,
  markProviderModelsLoading,
  reconcileSettingsWithProviderModels,
  toggleProviderModelInSettings,
} from "./provider-model-state";

const others = (provider: AiProvider) =>
  ALL_PROVIDERS.filter((item) => item !== provider);

const listed = (
  provider: AiProvider,
  ids: string[],
  source: ProviderModelState["source"] = "cli",
): ProviderModelState => ({
  error: null,
  installed: true,
  loading: false,
  models: ids.map((id) => createModelOption(provider, id, id)),
  source,
  version: "1.0.0",
});

describe.each(ALL_PROVIDERS)("provider %s", (provider) => {
  // Model ids every provider keeps as written (Claude Code's included).
  const [first, second] =
    provider === "anthropic" ? ["opus", "sonnet"] : ["model-a", "model-b"];

  test("toggling a model changes only its picked models", () => {
    const on = toggleProviderModelInSettings(DEFAULT_SETTINGS, provider, first);
    expect(getSelectedModels(provider, on)).toEqual([first]);
    expect(on.defaultModel).toBe(first);
    for (const other of others(provider)) {
      expect(getSelectedModels(other, on)).toEqual([]);
    }

    const both = toggleProviderModelInSettings(on, provider, second, true);
    expect(getSelectedModels(provider, both)).toEqual([first, second]);
    const off = toggleProviderModelInSettings(both, provider, first);
    expect(getSelectedModels(provider, off)).toEqual([second]);
  });

  test("loading and failing touch only it", () => {
    const loading = markProviderModelsLoading(
      DEFAULT_PROVIDER_MODELS,
      provider,
    );
    expect(loading[provider].loading).toBe(true);
    const failed = getProviderModelsErrorState(loading, "boom", provider);
    expect(failed[provider]).toMatchObject({ error: "boom", loading: false });
    for (const other of others(provider)) {
      expect(loading[other]).toBe(DEFAULT_PROVIDER_MODELS[other]);
      expect(failed[other]).toBe(DEFAULT_PROVIDER_MODELS[other]);
    }
  });

  test("a fetch result replaces only its listing", () => {
    const next = getProviderModelsFromResponse({
      fetchedAt: "2026-10-17T00:00:00.000Z",
      [provider]: {
        installed: true,
        models: [createModelOption(provider, first, first)],
        source: "cli",
      },
    });
    expect(next.fetchedAt).toBe("2026-10-17T00:00:00.000Z");
    expect(next[provider]).toMatchObject({
      error: null,
      installed: true,
      source: "cli",
    });
    expect(next[provider].models.map((model) => model.id)).toEqual([first]);
    for (const other of others(provider)) {
      expect(next[other]).toBe(DEFAULT_PROVIDER_MODELS[other]);
    }
  });

  test("its CLI's listing prunes its picked models, unless not authoritative", () => {
    const settings = withSelectedModels(DEFAULT_SETTINGS, provider, [
      first,
      second,
    ]);
    const pruned = reconcileSettingsWithProviderModels(settings, {
      ...DEFAULT_PROVIDER_MODELS,
      [provider]: listed(provider, [second]),
    });
    expect(getSelectedModels(provider, pruned)).toEqual([second]);

    const cached = reconcileSettingsWithProviderModels(settings, {
      ...DEFAULT_PROVIDER_MODELS,
      [provider]: listed(provider, [second], "unavailable"),
    });
    expect(getSelectedModels(provider, cached)).toEqual([first, second]);
  });
});

test("every provider starts out with nothing listed", () => {
  for (const provider of ALL_PROVIDERS) {
    expect(DEFAULT_PROVIDER_MODELS[provider]).toMatchObject({
      installed: false,
      loading: false,
      models: [],
    });
  }
  expect(DEFAULT_PROVIDER_MODELS.fetchedAt).toBeNull();
});
