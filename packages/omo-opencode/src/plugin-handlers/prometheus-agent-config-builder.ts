import type { AgentOverrideConfig, CategoryConfig } from "../config/schema";
import type { FallbackModels } from "../config/schema/fallback-models";
import { PROMETHEUS_PERMISSION, getPrometheusPrompt } from "../agents/prometheus";
import { resolvePromptAppend } from "../agents/builtin-agents/resolve-file-uri";
import { resolveAgentPromptAppend } from "../agents/builtin-agents/resolve-prompt-append";
import { AGENT_MODEL_REQUIREMENTS } from "../shared/model-requirements";
import type { FallbackEntry } from "../shared/model-requirements";
import {
  fetchAvailableModels,
  readConnectedProvidersCache,
  resolveModelPipeline,
} from "../shared";
import { resolveCategoryConfig } from "./category-config-resolver";

type PrometheusOverride = Record<string, unknown> & AgentOverrideConfig & {
  fallback_models?: FallbackModels;
};

function isModelInFallbackChain(
  model: string | undefined,
  fallbackChain: FallbackEntry[] | undefined,
): boolean {
  if (!model || !fallbackChain || fallbackChain.length === 0) {
    return false;
  }

  const modelParts = model.split("/");
  const modelName = modelParts.length >= 2 ? modelParts.slice(1).join("/") : model;

  return fallbackChain.some((entry) => entry.model === modelName);
}

export async function buildPrometheusAgentConfig(params: {
  configAgentPlan: Record<string, unknown> | undefined;
  pluginPrometheusOverride: PrometheusOverride | undefined;
  userCategories: Record<string, CategoryConfig> | undefined;
  currentModel: string | undefined;
  disabledTools?: readonly string[];
  directory?: string;
}): Promise<Record<string, unknown>> {
  const categoryConfig = params.pluginPrometheusOverride?.category
    ? resolveCategoryConfig(params.pluginPrometheusOverride.category, params.userCategories)
    : undefined;

  const requirement = AGENT_MODEL_REQUIREMENTS["prometheus"];
  const connectedProviders = readConnectedProvidersCache();
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  });

  const configuredPrometheusModel =
    params.pluginPrometheusOverride?.model ?? categoryConfig?.model;

  const shouldUseCurrentModel = isModelInFallbackChain(
    params.currentModel,
    requirement?.fallbackChain,
  );

  const modelResolution = resolveModelPipeline({
    intent: {
      uiSelectedModel: configuredPrometheusModel
        ? undefined
        : shouldUseCurrentModel
          ? params.currentModel
          : undefined,
      userModel: params.pluginPrometheusOverride?.model,
      categoryDefaultModel: categoryConfig?.model,
    },
    constraints: { availableModels },
    policy: {
      fallbackChain: requirement?.fallbackChain,
      systemDefaultModel: undefined,
    },
  });

  const resolvedModel = modelResolution?.model;
  const resolvedVariant = modelResolution?.variant;
  const currentModelVariant = shouldUseCurrentModel
    ? requirement?.fallbackChain.find((entry) =>
        isModelInFallbackChain(params.currentModel, [entry]),
      )?.variant
    : undefined;

  const variantToUse =
    params.pluginPrometheusOverride?.variant ?? resolvedVariant ?? currentModelVariant;
  const reasoningToUse =
    params.pluginPrometheusOverride?.reasoning ?? categoryConfig?.reasoning;
  const reasoningEffortToUse =
    params.pluginPrometheusOverride?.reasoningEffort ?? categoryConfig?.reasoningEffort;
  const textVerbosityToUse =
    params.pluginPrometheusOverride?.textVerbosity ?? categoryConfig?.textVerbosity;
  const thinkingToUse = params.pluginPrometheusOverride?.thinking ?? categoryConfig?.thinking;
  const temperatureToUse =
    params.pluginPrometheusOverride?.temperature ?? categoryConfig?.temperature;
  const topPToUse = params.pluginPrometheusOverride?.top_p ?? categoryConfig?.top_p;
  const maxTokensToUse =
    params.pluginPrometheusOverride?.maxTokens ?? categoryConfig?.maxTokens;
  const fallbackModelsToUse =
    params.pluginPrometheusOverride?.fallback_models ?? categoryConfig?.fallback_models;

  const base: Record<string, unknown> = {
    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...(variantToUse ? { variant: variantToUse } : {}),
    ...(reasoningToUse ? { reasoning: reasoningToUse } : {}),
    mode: "primary",
    prompt: getPrometheusPrompt(resolvedModel, params.disabledTools),
    permission: PROMETHEUS_PERMISSION,
    description: `${(params.configAgentPlan?.description as string) ?? "Plan agent"} (Prometheus - OhMyOpenCode)`,
    color: (params.configAgentPlan?.color as string) ?? "#FF5722",
    ...(temperatureToUse !== undefined ? { temperature: temperatureToUse } : {}),
    ...(topPToUse !== undefined ? { top_p: topPToUse } : {}),
    ...(maxTokensToUse !== undefined ? { maxTokens: maxTokensToUse } : {}),
    ...(fallbackModelsToUse !== undefined ? { fallback_models: fallbackModelsToUse } : {}),
    ...(categoryConfig?.tools ? { tools: categoryConfig.tools } : {}),
    ...(thinkingToUse ? { thinking: thinkingToUse } : {}),
    ...(reasoningEffortToUse !== undefined
      ? { reasoningEffort: reasoningEffortToUse }
      : {}),
    ...(textVerbosityToUse !== undefined
      ? { textVerbosity: textVerbosityToUse }
      : {}),
  };

  const override = params.pluginPrometheusOverride;
  if (!override) return base;

  const {
    prompt,
    prompt_append,
    prompt_append_exclude_model_keywords,
    prompt_append_always,
    ...restOverride
  } = override;
  const merged = { ...base, ...restOverride };
  if (typeof merged.prompt === "string") {
    if (prompt) {
      merged.prompt = merged.prompt + "\n" + resolvePromptAppend(prompt, params.directory);
    }
    const promptAppend = resolveAgentPromptAppend({
      model: resolvedModel,
      promptAppend: prompt_append,
      promptAppendAlways: prompt_append_always,
      excludeModelKeywords: prompt_append_exclude_model_keywords,
      configDir: params.directory,
    });
    if (promptAppend !== undefined) {
      merged.prompt = merged.prompt + "\n" + promptAppend;
    }
  }
  return merged;
}
