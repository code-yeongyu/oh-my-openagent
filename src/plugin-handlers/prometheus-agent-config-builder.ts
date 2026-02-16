import type { CategoryConfig } from "../config/schema";
import { PROMETHEUS_PERMISSION, PROMETHEUS_SYSTEM_PROMPT } from "../agents/prometheus";
import { resolvePromptAppend } from "../agents/builtin-agents/resolve-file-uri";
import { AGENT_MODEL_REQUIREMENTS } from "../shared/model-requirements";
import {
  fetchAvailableModels,
  readConnectedProvidersCache,
  resolveModelPipeline,
} from "../shared";
import { resolveCategoryConfig } from "./category-config-resolver";

type PrometheusOverride = Record<string, unknown> & {
  category?: string;
  model?: string;
  variant?: string;
  reasoningEffort?: string;
  textVerbosity?: string;
  thinking?: { type: string; budgetTokens?: number };
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  prompt_append?: string;
};

export async function buildPrometheusAgentConfig(params: {
  configAgentPlan: Record<string, unknown> | undefined;
  pluginPrometheusOverride: PrometheusOverride | undefined;
  userCategories: Record<string, CategoryConfig> | undefined;
  currentModel: string | undefined;
}): Promise<Record<string, unknown>> {
  const categoryConfig = params.pluginPrometheusOverride?.category
    ? resolveCategoryConfig(params.pluginPrometheusOverride.category, params.userCategories)
    : undefined;

  const requirement = AGENT_MODEL_REQUIREMENTS["prometheus"];
  const connectedProviders = readConnectedProvidersCache();
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  });

  const modelResolution = resolveModelPipeline({
    intent: {
      uiSelectedModel: params.currentModel,
      userModel: params.pluginPrometheusOverride?.model ?? categoryConfig?.model,
    },
    constraints: { availableModels },
    policy: {
      fallbackChain: requirement?.fallbackChain,
      systemDefaultModel: undefined,
    },
  });

  const resolvedModel = modelResolution?.model;
  const resolvedVariant = modelResolution?.variant;

  const variantToUse = params.pluginPrometheusOverride?.variant ?? resolvedVariant;
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

  const base: Record<string, unknown> = {
    name: "prometheus",
    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...(variantToUse ? { variant: variantToUse } : {}),
    mode: "all",
    prompt: PROMETHEUS_SYSTEM_PROMPT,
    permission: PROMETHEUS_PERMISSION,
    description: `${(params.configAgentPlan?.description as string) ?? "Plan agent"} (Prometheus - OhMyOpenCode)`,
    color: (params.configAgentPlan?.color as string) ?? "#FF5722",
    ...(temperatureToUse !== undefined ? { temperature: temperatureToUse } : {}),
    ...(topPToUse !== undefined ? { top_p: topPToUse } : {}),
    ...(maxTokensToUse !== undefined ? { maxTokens: maxTokensToUse } : {}),
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

  const { prompt_append, ...restOverride } = override;
  const merged = { ...base, ...restOverride };
  if (prompt_append && typeof merged.prompt === "string") {
    merged.prompt = merged.prompt + "\n" + resolvePromptAppend(prompt_append);
  }
  return merged;
}
