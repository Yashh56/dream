// What the store knows of each provider's models: the models its CLI lists
// (fetched, loading, failed), and the settings a fetch reconciles. Every
// function runs over all providers (provider-capabilities.js's ids), so
// adding a provider adds no line here; only how a provider's listed models
// are shown (sorted, filtered) is said per provider, in MODEL_OPTION_VIEWS.
import {
  ALL_PROVIDERS,
  getSelectedModels,
  normalizeDefaultModelSettings,
  withSelectedModels,
} from "@/lib/ide-defaults";
import {
  dedupeModelOptions,
  isVisibleOpenAiModelOption,
  type ModelOption,
  sortCursorModelOptions,
} from "@/lib/models";
import type { AiProvider, AppSettings } from "@/types/ide";
import type { ProviderModelState, ProviderModelsResponse } from "../ide-types";
import type { IdeState } from "./ide-store-types";

type ProviderModels = IdeState["providerModels"];

/** How a provider's listed models are shown, where not as listed. */
const MODEL_OPTION_VIEWS: Partial<
  Record<AiProvider, (options: ModelOption[]) => ModelOption[]>
> = {
  cursor: sortCursorModelOptions,
  openai: (options) => options.filter(isVisibleOpenAiModelOption),
};

/** `update` applied to each provider's state, `fetchedAt` kept. */
const mapProviders = (
  providerModels: Pick<ProviderModels, "fetchedAt">,
  update: (provider: AiProvider) => ProviderModelState,
): ProviderModels =>
  ({
    ...Object.fromEntries(
      ALL_PROVIDERS.map((provider) => [provider, update(provider)]),
    ),
    fetchedAt: providerModels.fetchedAt,
  }) as ProviderModels;

const EMPTY_PROVIDER_MODELS: ProviderModelState = {
  error: null,
  installed: false,
  loading: false,
  models: [],
  source: "unavailable",
  version: null,
};

export const DEFAULT_PROVIDER_MODELS: ProviderModels = mapProviders(
  { fetchedAt: null },
  () => EMPTY_PROVIDER_MODELS,
);

export const toggleProviderModelInSettings = (
  settings: AppSettings,
  provider: AiProvider,
  model: string,
  enabled?: boolean,
): AppSettings => {
  const current = getSelectedModels(provider, settings);
  const shouldEnable = enabled ?? !current.includes(model);
  const next = shouldEnable
    ? current.includes(model)
      ? current
      : [...current, model]
    : current.filter((value) => value !== model);

  return normalizeDefaultModelSettings(
    withSelectedModels(settings, provider, next),
  );
};

/** One provider (or, without one, every provider) starts loading. */
export const markProviderModelsLoading = (
  providerModels: ProviderModels,
  provider?: AiProvider,
): ProviderModels =>
  mapProviders(providerModels, (item) =>
    provider === undefined || provider === item
      ? { ...providerModels[item], error: null, loading: true }
      : providerModels[item],
  );

export const getProviderModelsFromResponse = (
  payload: ProviderModelsResponse,
  previous: ProviderModels = DEFAULT_PROVIDER_MODELS,
): ProviderModels =>
  mapProviders(
    { fetchedAt: payload.fetchedAt ?? new Date().toISOString() },
    (provider) => {
      const result = payload[provider];
      if (!result) return previous[provider];
      const options = dedupeModelOptions(result.models);
      return {
        error: result.error ?? null,
        installed: result.installed,
        loading: false,
        models: MODEL_OPTION_VIEWS[provider]?.(options) ?? options,
        source: result.source,
        version: result.version ?? null,
      };
    },
  );

/** Whether a provider's listing is authoritative enough to prune picks. */
const shouldReconcileProviderSelection = (
  providerModels: ProviderModelState,
): boolean =>
  providerModels.source === "cli" &&
  providerModels.error === null &&
  providerModels.models.length > 0;

/**
 * The settings with each provider's picked models pruned to what its CLI
 * now lists (where the listing is authoritative), defaults repaired.
 */
export const reconcileSettingsWithProviderModels = (
  settings: AppSettings,
  providerModels: ProviderModels,
): AppSettings => {
  let next = settings;
  for (const provider of ALL_PROVIDERS) {
    const state = providerModels[provider];
    const selected = getSelectedModels(provider, settings);
    const available = state.models.map((model) => model.id);
    next = withSelectedModels(
      next,
      provider,
      shouldReconcileProviderSelection(state)
        ? selected.filter((model) => available.includes(model))
        : selected,
    );
  }

  return normalizeDefaultModelSettings(next);
};

/** One provider (or, without one, every provider) failed with `message`. */
export const getProviderModelsErrorState = (
  providerModels: ProviderModels,
  message: string,
  provider?: AiProvider,
): ProviderModels =>
  mapProviders(providerModels, (item) =>
    provider && provider !== item
      ? providerModels[item]
      : { ...providerModels[item], error: message, loading: false },
  );
