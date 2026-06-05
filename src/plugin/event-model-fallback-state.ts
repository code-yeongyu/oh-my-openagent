import type { OhMyOpenCodeConfig } from "../config";
import { resolveRegisteredAgentName } from "../features/claude-code-session-state";
import type { ModelFallbackHook } from "../hooks/model-fallback/hook";
import { setSessionFallbackChain } from "../hooks/model-fallback/hook";
import { getRawFallbackModels } from "../hooks/runtime-fallback/fallback-models";
import {
  dispatchInternalPrompt,
  isInternalPromptDispatchAccepted,
  releasePromptAsyncReservation,
} from "../hooks/shared/prompt-async-gate";
import { createInternalAgentContinuationTextPart } from "../shared";
import { getAgentConfigKey } from "../shared/agent-display-names";
import { readConnectedProvidersCache } from "../shared/connected-providers-cache";
import { buildFallbackChainFromModels } from "../shared/fallback-chain-from-models";
import { isAmbiguousPostDispatchPromptFailure } from "../shared/prompt-failure-classifier";
import { getSessionModel } from "../shared/session-model-state";
import { log } from "../shared/logger";
import type { PluginEventContext } from "./event-types";

export type FallbackContinuationContext = {
  agentName?: string;
  providerID?: string;
  dedupeProviderID?: string;
  modelID?: string;
};

type FallbackContinuationDedupeKeys = {
  modelKey?: string;
  providerModelKey?: string;
};

type FallbackContinuationDedupeState = {
  modelKeys: Set<string>;
  providerModelKeys: Set<string>;
  providerlessModelKeys: Set<string>;
};

export function applyUserConfiguredFallbackChain(
  modelFallback: Pick<ModelFallbackHook, "setSessionFallbackChain"> | null | undefined,
  sessionID: string,
  agentName: string,
  currentProviderID: string,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const agentKey = getAgentConfigKey(agentName);
  const rawFallbackModels = getRawFallbackModels(sessionID, agentKey, pluginConfig);
  if (!rawFallbackModels || rawFallbackModels.length === 0) return;

  const fallbackChain = buildFallbackChainFromModels(rawFallbackModels, currentProviderID);

  if (fallbackChain && fallbackChain.length > 0 && modelFallback) {
    setSessionFallbackChain(modelFallback, sessionID, fallbackChain);
  }
}

export function createModelFallbackContinuationController(args: {
  pluginConfig: OhMyOpenCodeConfig;
  pluginContext: PluginEventContext;
  lastKnownModelBySession: Map<string, { providerID: string; modelID: string }>;
  continuationsInFlight: Set<string>;
  lastDispatchedContinuationKeys: Map<string, FallbackContinuationDedupeState>;
}) {
  const { pluginConfig, pluginContext, lastKnownModelBySession, continuationsInFlight } = args;
  const lastDispatchedContinuationKeys = args.lastDispatchedContinuationKeys;

  const resolveFallbackProviderID = (sessionID: string, providerHint?: string): string => {
    const normalizedProviderHint = providerHint?.trim();
    if (normalizedProviderHint) return normalizedProviderHint;

    const sessionModel = getSessionModel(sessionID);
    if (sessionModel?.providerID) return sessionModel.providerID;

    const lastKnownModel = lastKnownModelBySession.get(sessionID);
    if (lastKnownModel?.providerID) return lastKnownModel.providerID;

    const connectedProvider = readConnectedProvidersCache()?.[0];
    if (connectedProvider) return connectedProvider;

    return "opencode";
  };

  const getFallbackContinuationKeys = (
    fallbackContext?: FallbackContinuationContext,
  ): FallbackContinuationDedupeKeys => {
    const agentKey = fallbackContext?.agentName
      ? getAgentConfigKey(fallbackContext.agentName).trim().toLowerCase()
      : "";
    const providerID = fallbackContext?.dedupeProviderID?.trim().toLowerCase() ?? "";
    const modelID = fallbackContext?.modelID?.trim().toLowerCase() ?? "";

    if (!agentKey || !modelID) return {};

    return {
      modelKey: `${agentKey}:${modelID}`,
      ...(providerID ? { providerModelKey: `${agentKey}:${providerID}:${modelID}` } : {}),
    };
  };

  const getDedupeState = (sessionID: string): FallbackContinuationDedupeState => {
    const existingState = lastDispatchedContinuationKeys.get(sessionID);
    if (existingState) return existingState;

    const state = {
      modelKeys: new Set<string>(),
      providerModelKeys: new Set<string>(),
      providerlessModelKeys: new Set<string>(),
    };
    lastDispatchedContinuationKeys.set(sessionID, state);
    return state;
  };

  const wasAlreadyDispatched = (
    state: FallbackContinuationDedupeState | undefined,
    keys: FallbackContinuationDedupeKeys,
  ): boolean => {
    if (!state || !keys.modelKey) return false;
    if (!keys.providerModelKey) return state.modelKeys.has(keys.modelKey);
    return state.providerModelKeys.has(keys.providerModelKey) || state.providerlessModelKeys.has(keys.modelKey);
  };

  const shouldSkipFallbackContinuation = (
    sessionID: string,
    source: string,
    fallbackContext?: FallbackContinuationContext,
  ): boolean => {
    const fallbackKeys = getFallbackContinuationKeys(fallbackContext);

    if (continuationsInFlight.has(sessionID)) {
      log("[event] model-fallback continuation skipped because one is already in flight", { sessionID, source });
      return true;
    }

    const lastDispatchedKeys = lastDispatchedContinuationKeys.get(sessionID);
    if (wasAlreadyDispatched(lastDispatchedKeys, fallbackKeys)) {
      log("[event] model-fallback continuation skipped because matching fallback was already dispatched", {
        sessionID,
        source,
      });
      return true;
    }

    return false;
  };

  const markDispatched = (sessionID: string, fallbackContext?: FallbackContinuationContext): void => {
    const fallbackKeys = getFallbackContinuationKeys(fallbackContext);
    if (!fallbackKeys.modelKey) return;

    const dispatchedKeys = getDedupeState(sessionID);
    dispatchedKeys.modelKeys.add(fallbackKeys.modelKey);
    if (fallbackKeys.providerModelKey) {
      dispatchedKeys.providerModelKeys.add(fallbackKeys.providerModelKey);
    } else {
      dispatchedKeys.providerlessModelKeys.add(fallbackKeys.modelKey);
    }
  };

  const autoContinueAfterFallback = async (
    sessionID: string,
    source: string,
    fallbackContext?: FallbackContinuationContext,
  ): Promise<void> => {
    if (shouldSkipFallbackContinuation(sessionID, source, fallbackContext)) return;

    continuationsInFlight.add(sessionID);
    let dispatched = false;
    try {
      try {
        await pluginContext.client.session.abort({ path: { id: sessionID } });
      } catch (error) {
        log("[event] model-fallback abort failed", {
          sessionID,
          source,
          error: error instanceof Error ? error : String(error),
        });
        return;
      }
      releasePromptAsyncReservation(sessionID, `model-fallback-abort:${source}`, {
        reservedBy: [`model-fallback:${source}`, `model-fallback:${source}:sync`],
        reservedByPrefix: "model-fallback:",
      });

      const launchAgent = fallbackContext?.agentName
        ? resolveRegisteredAgentName(fallbackContext.agentName)
        : undefined;
      const launchModel = fallbackContext?.providerID && fallbackContext?.modelID
        ? { providerID: fallbackContext.providerID, modelID: fallbackContext.modelID }
        : undefined;
      const agentConfigKey = fallbackContext?.agentName ? getAgentConfigKey(fallbackContext.agentName) : undefined;
      const agentSettings = agentConfigKey
        ? pluginConfig.agents?.[agentConfigKey as keyof NonNullable<typeof pluginConfig.agents>]
        : undefined;
      const launchVariant = (agentSettings as { variant?: string } | undefined)?.variant;
      const promptBody = {
        path: { id: sessionID },
        body: {
          ...(launchAgent ? { agent: launchAgent } : {}),
          ...(launchModel ? { model: launchModel } : {}),
          ...(launchVariant ? { variant: launchVariant } : {}),
          parts: [createInternalAgentContinuationTextPart("continue")],
        },
        query: { directory: pluginContext.directory },
      };

      const mode = typeof pluginContext.client.session.promptAsync === "function" ? "async" : "sync";
      const promptResult = await dispatchInternalPrompt({
        mode,
        client: pluginContext.client,
        sessionID,
        source: mode === "async" ? `model-fallback:${source}` : `model-fallback:${source}:sync`,
        queueBehavior: "defer",
        input: promptBody,
      });
      if (isInternalPromptDispatchAccepted(promptResult)) {
        dispatched = true;
      } else if (promptResult.status === "failed") {
        if (isAmbiguousPostDispatchPromptFailure(promptResult)) dispatched = true;
        log(`[event] model-fallback ${mode === "async" ? "promptAsync" : "prompt"} failed`, {
          sessionID,
          source,
          error: promptResult.error,
        });
      } else {
        log(`[event] model-fallback ${mode === "async" ? "promptAsync" : "prompt"} skipped by gate`, {
          sessionID,
          source,
          status: promptResult.status,
        });
      }
    } finally {
      if (dispatched) markDispatched(sessionID, fallbackContext);
      continuationsInFlight.delete(sessionID);
    }
  };

  return {
    autoContinueAfterFallback,
    resolveFallbackProviderID,
    shouldSkipFallbackContinuation,
  };
}
