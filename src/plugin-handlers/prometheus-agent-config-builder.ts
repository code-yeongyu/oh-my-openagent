import { resolvePromptAppend } from "../agents/builtin-agents/resolve-file-uri";
import { ORACLE_PERMISSION, ORACLE_SYSTEM_PROMPT } from "../agents/oracle";
import type { CategoryConfig } from "../config/schema";
import {
  fetchAvailableModels,
  readConnectedProvidersCache,
  resolveModelPipeline,
} from "../shared";
import { AGENT_MODEL_REQUIREMENTS } from "../shared/model-requirements";
import { resolveCategoryConfig } from "./category-config-resolver";

type OracleOverride = Record<string, unknown> & {
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

export async function buildOracleAgentConfig(params: {
  configAgentPlan: Record<string, unknown> | undefined;
  pluginOracleOverride: OracleOverride | undefined;
  userCategories: Record<string, CategoryConfig> | undefined;
  currentModel: string | undefined;
}): Promise<Record<string, unknown>> {
  const categoryConfig = params.pluginOracleOverride?.category
    ? resolveCategoryConfig(params.pluginOracleOverride.category, params.userCategories)
    : undefined;

  const requirement = AGENT_MODEL_REQUIREMENTS["oracle"];
  const connectedProviders = readConnectedProvidersCache();
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  });

  const modelResolution = resolveModelPipeline({
    intent: {
      uiSelectedModel: params.currentModel,
      userModel: params.pluginOracleOverride?.model ?? categoryConfig?.model,
    },
    constraints: { availableModels },
    policy: {
      fallbackChain: requirement?.fallbackChain,
      systemDefaultModel: undefined,
    },
  });

  const resolvedModel = modelResolution?.model;
  const resolvedVariant = modelResolution?.variant;

  const variantToUse = params.pluginOracleOverride?.variant ?? resolvedVariant;
  const reasoningEffortToUse =
    params.pluginOracleOverride?.reasoningEffort ?? categoryConfig?.reasoningEffort;
  const textVerbosityToUse =
    params.pluginOracleOverride?.textVerbosity ?? categoryConfig?.textVerbosity;
  const thinkingToUse = params.pluginOracleOverride?.thinking ?? categoryConfig?.thinking;
  const temperatureToUse =
    params.pluginOracleOverride?.temperature ?? categoryConfig?.temperature;
  const topPToUse = params.pluginOracleOverride?.top_p ?? categoryConfig?.top_p;
  const maxTokensToUse =
    params.pluginOracleOverride?.maxTokens ?? categoryConfig?.maxTokens;

  const base: Record<string, unknown> = {

    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...(variantToUse ? { variant: variantToUse } : {}),
    mode: "all",
    prompt: ORACLE_SYSTEM_PROMPT,
    permission: ORACLE_PERMISSION,
    description: `${(params.configAgentPlan?.description as string) ?? "Plan agent"} (Oracle - Matrixx)`,
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

  const override = params.pluginOracleOverride;
  if (!override) return base;

  const { prompt_append, ...restOverride } = override;
  const merged = { ...base, ...restOverride };
  if (prompt_append && typeof merged.prompt === "string") {
    merged.prompt = merged.prompt + "\n" + resolvePromptAppend(prompt_append);
  }
  return merged;
}
