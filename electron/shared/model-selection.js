// @ts-check
// Provider and model selection rules shared by the renderer and the main
// process. The persisted-state codec needs them to repair a stale default
// model on load; the renderer needs them everywhere a model is picked, and
// settles every project's and chat's model with them when settings change.
// Where a provider keeps its picked models, and how it spells a model id,
// is its row in provider-capabilities.js: nothing here names a provider.

import {
  PROVIDER_CAPABILITIES,
  PROVIDER_IDS,
} from "./provider-capabilities.js";

/** @typedef {import("../../src/types/ide").AiProvider} AiProvider */
/** @typedef {import("../../src/types/ide").AppSettings} AppSettings */
/** @typedef {import("../../src/types/ide").ModelSpeed} ModelSpeed */
/** @typedef {import("../../src/types/ide").ReasoningEffort} ReasoningEffort */
/** @typedef {import("./provider-capabilities.js").SelectedModelsSetting} SelectedModelsSetting */

/** @type {AiProvider} */
export const DEFAULT_PROVIDER = "openai";

/** Every provider, in display order: provider-capabilities.js's ids. */
export const ALL_PROVIDERS = PROVIDER_IDS;

export const CLAUDE_CODE_MODEL_IDS = /** @type {const} */ ({
  haiku: "haiku",
  opusOneMillion: "opus[1m]",
  opus: "opus",
  sonnetOneMillion: "sonnet[1m]",
  sonnet: "sonnet",
});

/** @type {ReasoningEffort[]} */
const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** @type {ModelSpeed[]} */
const MODEL_SPEEDS = ["standard", "fast"];

/**
 * @param {unknown} value
 * @returns {AiProvider}
 */
export const normalizeProvider = (value) =>
  PROVIDER_IDS.find((provider) => provider === value) ?? DEFAULT_PROVIDER;

/**
 * @param {unknown} value
 * @returns {ModelSpeed}
 */
export const normalizeModelSpeed = (value) =>
  MODEL_SPEEDS.includes(/** @type {ModelSpeed} */ (value))
    ? /** @type {ModelSpeed} */ (value)
    : "standard";

/**
 * "medium" is the implicit default and is represented as `null`.
 * @param {unknown} value
 * @returns {ReasoningEffort | null}
 */
export const normalizeReasoningEffort = (value) => {
  if (value === "medium") {
    return null;
  }

  return REASONING_EFFORTS.includes(/** @type {ReasoningEffort} */ (value))
    ? /** @type {ReasoningEffort} */ (value)
    : null;
};

/**
 * @param {unknown} value
 * @returns {value is ReasoningEffort}
 */
export const isReasoningEffort = (value) =>
  REASONING_EFFORTS.includes(/** @type {ReasoningEffort} */ (value));

/**
 * @param {string[]} models
 * @returns {string[]}
 */
export const dedupeModels = (models) =>
  Array.from(new Set(models.map((model) => model.trim()).filter(Boolean)));

/**
 * @param {string} modelId
 * @returns {string}
 */
export const normalizeClaudeCodeModelId = (modelId) => {
  const trimmed = modelId.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (trimmed.startsWith("claude-")) {
    return trimmed;
  }
  const usesOneMillionContext = /\[1m\]/i.test(trimmed);
  if (trimmed.includes("opus")) {
    return usesOneMillionContext
      ? CLAUDE_CODE_MODEL_IDS.opusOneMillion
      : CLAUDE_CODE_MODEL_IDS.opus;
  }
  if (trimmed.includes("haiku")) {
    return CLAUDE_CODE_MODEL_IDS.haiku;
  }
  if (trimmed.includes("sonnet")) {
    return usesOneMillionContext
      ? CLAUDE_CODE_MODEL_IDS.sonnetOneMillion
      : CLAUDE_CODE_MODEL_IDS.sonnet;
  }
  return trimmed;
};

/**
 * A model id as `provider` spells it.
 * @param {AiProvider} provider
 * @param {string} modelId
 * @returns {string}
 */
export const normalizeModelIdFor = (provider, modelId) =>
  PROVIDER_CAPABILITIES[provider].modelAliases === "claude-code"
    ? normalizeClaudeCodeModelId(modelId)
    : modelId;

/**
 * The models the user picked for `provider`, normalized and without
 * duplicates, whether or not the provider is enabled.
 * @param {AiProvider} provider
 * @param {Pick<AppSettings, SelectedModelsSetting>} settings
 * @returns {string[]}
 */
export const getSelectedModels = (provider, settings) =>
  dedupeModels(
    settings[PROVIDER_CAPABILITIES[provider].selectedModelsSetting].map(
      (model) => normalizeModelIdFor(provider, model),
    ),
  );

/**
 * `settings` with `models` as the models picked for `provider`.
 * @template {Pick<AppSettings, SelectedModelsSetting>} Settings
 * @param {Settings} settings
 * @param {AiProvider} provider
 * @param {string[]} models
 * @returns {Settings}
 */
export const withSelectedModels = (settings, provider, models) => ({
  ...settings,
  [PROVIDER_CAPABILITIES[provider].selectedModelsSetting]: models,
});

/**
 * Every provider's picked models from anything shaped like settings (a
 * stored record), each normalized; a missing or malformed list is empty.
 * @param {Record<string, unknown>} raw
 * @returns {Pick<AppSettings, SelectedModelsSetting>}
 */
export const decodeSelectedModels = (raw) =>
  /** @type {Pick<AppSettings, SelectedModelsSetting>} */ (
    Object.fromEntries(
      PROVIDER_IDS.map((provider) => {
        const key = PROVIDER_CAPABILITIES[provider].selectedModelsSetting;
        const value = raw[key];
        /** @type {string[]} */
        const models = Array.isArray(value)
          ? value.filter((model) => typeof model === "string")
          : [];
        return [
          key,
          dedupeModels(
            models.map((model) => normalizeModelIdFor(provider, model)),
          ),
        ];
      }),
    )
  );

/**
 * @param {AiProvider} provider
 * @param {AppSettings} settings
 * @returns {boolean}
 */
export const isProviderEnabled = (provider, settings) =>
  !settings.disabledProviders?.includes(provider);

/**
 * Models offered for a provider. A disabled provider offers none, which hides
 * it everywhere a model can be picked.
 * @param {AiProvider} provider
 * @param {AppSettings} settings
 * @returns {string[]}
 */
export const getModelsForProvider = (provider, settings) => {
  if (!isProviderEnabled(provider, settings)) {
    return [];
  }

  return getSelectedModels(provider, settings);
};

/**
 * @param {AppSettings} settings
 * @returns {AiProvider[]}
 */
export const getConnectedProviders = (settings) =>
  ALL_PROVIDERS.filter(
    (provider) => getModelsForProvider(provider, settings).length > 0,
  );

/**
 * @param {string} modelId
 * @param {AppSettings} settings
 * @returns {AiProvider | null}
 */
export const getProviderForModel = (modelId, settings) => {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return null;
  }

  for (const provider of getConnectedProviders(settings)) {
    const providerModels = getModelsForProvider(provider, settings);
    if (providerModels.includes(normalizeModelIdFor(provider, trimmed))) {
      return provider;
    }
  }

  return null;
};

/**
 * @param {string} modelId
 * @returns {string[]}
 */
const getDefaultModelCandidates = (modelId) => {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return [];
  }

  return Array.from(
    new Set([trimmed, normalizeClaudeCodeModelId(trimmed)].filter(Boolean)),
  );
};

/**
 * @param {AppSettings} settings
 * @returns {string}
 */
const getFirstAvailableModel = (settings) => {
  for (const provider of getConnectedProviders(settings)) {
    const model = getModelsForProvider(provider, settings)[0];
    if (model) {
      return model;
    }
  }

  return "";
};

/**
 * @param {AppSettings} settings
 * @param {string} [preferredModel]
 * @returns {string}
 */
export const getPreferredDefaultModel = (
  settings,
  preferredModel = settings.defaultModel,
) => {
  for (const candidate of getDefaultModelCandidates(preferredModel)) {
    if (getProviderForModel(candidate, settings)) {
      return candidate;
    }
  }

  return getFirstAvailableModel(settings);
};

/**
 * @typedef {object} ModelSelection
 * @property {string} model
 * @property {ModelSpeed} modelSpeed
 * @property {AiProvider} provider
 * @property {ReasoningEffort | null} reasoningEffort
 */

/**
 * @param {AppSettings} settings
 * @returns {ModelSelection}
 */
export const getDefaultModelSelection = (settings) => {
  const model = getPreferredDefaultModel(settings);
  const provider =
    getProviderForModel(model, settings) ??
    getConnectedProviders(settings)[0] ??
    DEFAULT_PROVIDER;

  return {
    model,
    modelSpeed: normalizeModelSpeed(settings.defaultModelSpeed),
    provider,
    reasoningEffort: isReasoningEffort(settings.defaultReasoningEffort)
      ? settings.defaultReasoningEffort
      : null,
  };
};

/**
 * @param {AppSettings} settings
 * @returns {ModelSelection}
 */
export const getDefaultGitGenerationModelSelection = (settings) => {
  const model = getPreferredDefaultModel(
    settings,
    settings.defaultGitGenerationModel || settings.defaultModel,
  );
  const provider =
    getProviderForModel(model, settings) ??
    getConnectedProviders(settings)[0] ??
    DEFAULT_PROVIDER;

  return {
    model,
    modelSpeed: normalizeModelSpeed(settings.defaultGitGenerationModelSpeed),
    provider,
    reasoningEffort: isReasoningEffort(
      settings.defaultGitGenerationReasoningEffort,
    )
      ? settings.defaultGitGenerationReasoningEffort
      : null,
  };
};

/**
 * Repairs stale default-model settings against the models actually selected.
 * @param {AppSettings} settings
 * @param {string} [preferredModel]
 * @returns {AppSettings}
 */
export const normalizeDefaultModelSettings = (
  settings,
  preferredModel = settings.defaultModel,
) => {
  const defaultModel = getPreferredDefaultModel(settings, preferredModel);
  const defaultSelection = getDefaultModelSelection({
    ...settings,
    defaultModel,
  });

  return {
    ...settings,
    defaultGitGenerationModel: getPreferredDefaultModel(
      settings,
      settings.defaultGitGenerationModel || defaultModel,
    ),
    defaultModel,
    defaultModelSpeed: defaultSelection.modelSpeed,
    defaultReasoningEffort: defaultSelection.reasoningEffort,
  };
};

/**
 * The model a project or chat on `provider` falls back to: the default
 * model when it is this provider's, else the provider's first picked model.
 * @param {AiProvider} provider
 * @param {AppSettings} settings
 * @returns {string}
 */
export const getDefaultModelForProvider = (provider, settings) => {
  const providerModels = getModelsForProvider(provider, settings);
  const defaultSelection = getDefaultModelSelection(settings);

  if (
    defaultSelection.provider === provider &&
    providerModels.includes(defaultSelection.model)
  ) {
    return defaultSelection.model;
  }

  return providerModels[0] ?? "";
};

/**
 * Whether two settings pick the same models and defaults: everything
 * settling can change.
 * @param {AppSettings} a
 * @param {AppSettings} b
 * @returns {boolean}
 */
export const areModelSettingsEqual = (a, b) =>
  a.defaultModel === b.defaultModel &&
  a.defaultGitGenerationModel === b.defaultGitGenerationModel &&
  a.defaultModelSpeed === b.defaultModelSpeed &&
  a.defaultReasoningEffort === b.defaultReasoningEffort &&
  PROVIDER_IDS.every((provider) => {
    const key = PROVIDER_CAPABILITIES[provider].selectedModelsSetting;
    return (
      a[key].length === b[key].length &&
      a[key].every((model, index) => b[key][index] === model)
    );
  });

/**
 * Settles the models in use against the settings:
 * - the picked models are normalized and without duplicates, and the
 *   defaults name a picked model;
 * - every open project, and each of its chats, runs a model that is
 *   offered. On a provider that offers nothing (disabled, or no model
 *   picked) while another does, it moves to the default selection; on a
 *   model its provider no longer offers, to the provider's fallback
 *   (getDefaultModelForProvider).
 *
 * Pure. Whatever needs no change is answered as the same object, so a
 * caller can tell what moved by identity.
 * @template {{ id: string, provider: AiProvider, model: string }} Project
 * @template {{ projectId: string, provider: AiProvider, model: string }} Chat
 * @param {{ settings: AppSettings, projects: Project[], chats: Chat[] }} state
 * @returns {{ settings: AppSettings, projects: Project[], chats: Chat[] }}
 */
export const settleModelSelection = ({ settings, projects, chats }) => {
  let picked = settings;
  for (const provider of PROVIDER_IDS) {
    picked = withSelectedModels(
      picked,
      provider,
      getSelectedModels(provider, settings),
    );
  }
  const normalized = normalizeDefaultModelSettings(picked);
  const settled = areModelSettingsEqual(normalized, settings)
    ? settings
    : normalized;

  const connected = getConnectedProviders(settled);
  const defaultSelection = getDefaultModelSelection(settled);
  /**
   * @template {{ provider: AiProvider, model: string }} Item
   * @param {Item} item
   * @returns {Item}
   */
  const settleItem = (item) => {
    let next = item;
    if (connected.length > 0 && !connected.includes(next.provider)) {
      next = {
        ...next,
        model:
          defaultSelection.model ||
          getDefaultModelForProvider(defaultSelection.provider, settled),
        provider: defaultSelection.provider,
      };
    }
    const fallbackModel = getDefaultModelForProvider(next.provider, settled);
    if (
      next.model !== fallbackModel &&
      !getModelsForProvider(next.provider, settled).includes(next.model)
    ) {
      next = { ...next, model: fallbackModel };
    }
    return next;
  };
  /**
   * @template T
   * @param {T[]} items
   * @param {(item: T) => T} settle
   * @returns {T[]}
   */
  const settleAll = (items, settle) => {
    const next = items.map(settle);
    return next.some((item, index) => item !== items[index]) ? next : items;
  };

  const settledProjects = settleAll(projects, settleItem);
  const openProjectIds = new Set(settledProjects.map((project) => project.id));
  const settledChats = settleAll(chats, (chat) =>
    openProjectIds.has(chat.projectId) ? settleItem(chat) : chat,
  );

  return { chats: settledChats, projects: settledProjects, settings: settled };
};
