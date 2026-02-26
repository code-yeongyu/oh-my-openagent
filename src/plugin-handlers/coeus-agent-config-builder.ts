import type { CategoryConfig } from "../config/schema";
import { COEUS_SYSTEM_PROMPT } from "../agents/coeus";
import { resolvePromptAppend } from "../agents/builtin-agents/resolve-file-uri";
import { AGENT_MODEL_REQUIREMENTS } from "../shared/model-requirements";
import {
  fetchAvailableModels,
  readConnectedProvidersCache,
  resolveModelPipeline,
} from "../shared";
import { resolveCategoryConfig } from "./category-config-resolver";

type CoeusOverride = Record<string, unknown> & {
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

export async function buildCoeusAgentConfig(params: {
  configAgentCoeus: Record<string, unknown> | undefined;
  pluginCoeusOverride: CoeusOverride | undefined;
  userCategories: Record<string, CategoryConfig> | undefined;
  currentModel: string | undefined;
}): Promise<Record<string, unknown>> {
  const categoryConfig = params.pluginCoeusOverride?.category
    ? resolveCategoryConfig(params.pluginCoeusOverride.category, params.userCategories)
    : undefined;

  const requirement = AGENT_MODEL_REQUIREMENTS["coeus"];
  const connectedProviders = readConnectedProvidersCache();
  const availableModels = await fetchAvailableModels(undefined, {
    connectedProviders: connectedProviders ?? undefined,
  });

  const modelResolution = resolveModelPipeline({
    intent: {
      uiSelectedModel: params.currentModel,
      userModel: params.pluginCoeusOverride?.model ?? categoryConfig?.model,
    },
    constraints: { availableModels },
    policy: {
      fallbackChain: requirement?.fallbackChain,
      systemDefaultModel: undefined,
    },
  });

  const resolvedModel = modelResolution?.model;
  const resolvedVariant = modelResolution?.variant;

  const variantToUse = params.pluginCoeusOverride?.variant ?? resolvedVariant;
  const reasoningEffortToUse =
    params.pluginCoeusOverride?.reasoningEffort ?? categoryConfig?.reasoningEffort;
  const textVerbosityToUse =
    params.pluginCoeusOverride?.textVerbosity ?? categoryConfig?.textVerbosity;
  const thinkingToUse = params.pluginCoeusOverride?.thinking ?? categoryConfig?.thinking;
  const temperatureToUse =
    params.pluginCoeusOverride?.temperature ?? categoryConfig?.temperature;
  const topPToUse = params.pluginCoeusOverride?.top_p ?? categoryConfig?.top_p;
  const maxTokensToUse =
    params.pluginCoeusOverride?.maxTokens ?? categoryConfig?.maxTokens;

  const base: Record<string, unknown> = {
    ...(resolvedModel ? { model: resolvedModel } : {}),
    ...(variantToUse ? { variant: variantToUse } : {}),
    mode: "all",
    prompt: COEUS_SYSTEM_PROMPT,
    description: `${(params.configAgentCoeus?.description as string) ?? "Recursive planner"} (Coeus - OhMyOpenCode)`,
    color: (params.configAgentCoeus?.color as string) ?? "#A98181",
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

  const override = params.pluginCoeusOverride;
  if (!override) return base;

  const { prompt_append, ...restOverride } = override;
  const merged = { ...base, ...restOverride };
  if (prompt_append && typeof merged.prompt === "string") {
    merged.prompt = merged.prompt + "\n" + resolvePromptAppend(prompt_append);
  }
  return merged;
}
