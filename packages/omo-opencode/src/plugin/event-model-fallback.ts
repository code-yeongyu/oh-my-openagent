import type { OhMyOpenCodeConfig } from "../config";
import { getMainSessionID, getSessionAgent } from "../features/claude-code-session-state";
import {
  clearPendingModelFallback,
  clearSessionFallbackChain,
  setPendingModelFallback,
  type ModelFallbackHook,
} from "../hooks/model-fallback/hook";
import { shouldRetryError } from "../shared/model-error-classifier";
import { extractRetryAttempt, normalizeRetryStatusMessage } from "../shared/retry-status-utils";
import {
  extractErrorMessage,
  extractErrorName,
  extractProviderModelFromErrorMessage,
  normalizeFallbackModelID,
  resolveFallbackAgentName,
} from "./event-error-utils";
import {
  applyUserConfiguredFallbackChain,
  createModelFallbackContinuationController,
  type FallbackContinuationContext,
} from "./event-model-fallback-state";
import type { PluginEventContext } from "./event-types";

export function createModelFallbackEventHandler(args: {
  pluginConfig: OhMyOpenCodeConfig;
  pluginContext: PluginEventContext;
  modelFallback: ModelFallbackHook | null | undefined;
  isModelFallbackEnabled: boolean;
  isRuntimeFallbackEnabled: boolean;
  shouldAutoRetrySession: (sessionID: string) => boolean;
  isSessionStopped: (sessionID: string) => boolean;
}) {
  const lastHandledModelErrorMessageID = new Map<string, string>();
  const lastHandledRetryStatusKey = new Map<string, string>();
  const lastKnownModelBySession = new Map<string, { providerID: string; modelID: string }>();
  const continuationOwners = new Map<string, symbol>();
  const lastDispatchedContinuationKeys = new Map<
    string,
    {
      modelKeys: Set<string>;
      providerModelKeys: Set<string>;
      providerlessModelKeys: Set<string>;
    }
  >();
  const continuation = createModelFallbackContinuationController({
    pluginConfig: args.pluginConfig,
    pluginContext: args.pluginContext,
    lastKnownModelBySession,
    continuationOwners,
    lastDispatchedContinuationKeys,
  });

  const clearSession = (sessionID: string): void => {
    lastHandledModelErrorMessageID.delete(sessionID);
    lastHandledRetryStatusKey.delete(sessionID);
    lastKnownModelBySession.delete(sessionID);
    continuationOwners.delete(sessionID);
    lastDispatchedContinuationKeys.delete(sessionID);
    if (args.modelFallback) {
      clearPendingModelFallback(args.modelFallback, sessionID);
      clearSessionFallbackChain(args.modelFallback, sessionID);
    }
  };

  const clearRetryDedupeAfterIdle = (sessionID: string): void => {
    lastHandledRetryStatusKey.delete(sessionID);
    lastDispatchedContinuationKeys.delete(sessionID);
  };

  const setLastKnownModel = (sessionID: string, model: { providerID: string; modelID: string }): void => {
    lastKnownModelBySession.set(sessionID, model);
  };

  const applyFallback = async (
    sessionID: string,
    source: string,
    agentName: string,
    currentProvider: string,
    currentModel: string,
    shouldAutoContinue: boolean,
    fallbackContext: FallbackContinuationContext,
  ): Promise<void> => {
    if (shouldAutoContinue && continuation.shouldSkipFallbackContinuation(sessionID, source, fallbackContext)) return;

    applyUserConfiguredFallbackChain(args.modelFallback, sessionID, agentName, currentProvider, args.pluginConfig);
    const setFallback = args.modelFallback
      ? setPendingModelFallback(args.modelFallback, sessionID, agentName, currentProvider, currentModel)
      : false;

    if (setFallback && shouldAutoContinue) {
      await continuation.autoContinueAfterFallback(sessionID, source, fallbackContext);
    }
  };

  const shouldHandleModelFallback = (): boolean => {
    return args.isModelFallbackEnabled && !args.isRuntimeFallbackEnabled;
  };

  const handleAssistantMessageUpdated = async (params: {
    sessionID: string;
    info: Record<string, unknown>;
    agent?: string;
  }): Promise<boolean> => {
    if (!shouldHandleModelFallback()) return false;

    const assistantMessageID = params.info.id as string | undefined;
    const assistantError = params.info.error;
    if (!assistantMessageID || !assistantError) return false;

    const lastHandled = lastHandledModelErrorMessageID.get(params.sessionID);
    if (lastHandled === assistantMessageID) return true;

    const errorName = extractErrorName(assistantError);
    const errorMessage = extractErrorMessage(assistantError);
    if (!shouldRetryError({ name: errorName, message: errorMessage })) return false;

    const agentName = resolveFallbackAgentName({
      currentAgent: params.agent ?? getSessionAgent(params.sessionID),
      sessionID: params.sessionID,
      mainSessionID: getMainSessionID(),
      message: errorMessage,
    });
    if (!agentName) return false;

    const providerHint = params.info.providerID as string | undefined;
    const currentProvider = continuation.resolveFallbackProviderID(params.sessionID, providerHint);
    const rawModel = (params.info.modelID as string | undefined) ?? "claude-opus-4-7";
    const currentModel = normalizeFallbackModelID(rawModel);
    const fallbackContext = { agentName, providerID: currentProvider, dedupeProviderID: providerHint, modelID: currentModel };
    const shouldAutoContinue = args.shouldAutoRetrySession(params.sessionID) && !args.isSessionStopped(params.sessionID);

    await applyFallback(
      params.sessionID,
      "message.updated",
      agentName,
      currentProvider,
      currentModel,
      shouldAutoContinue,
      fallbackContext,
    );
    if (shouldAutoContinue) lastHandledModelErrorMessageID.set(params.sessionID, assistantMessageID);
    return false;
  };

  const handleSessionStatus = async (params: {
    sessionID: string;
    status?: { type?: string; attempt?: number; message?: string; next?: number };
  }): Promise<boolean> => {
    if (params.status?.type === "idle") clearRetryDedupeAfterIdle(params.sessionID);
    if (params.status?.type !== "retry" || !shouldHandleModelFallback()) return false;

    const retryMessage = typeof params.status.message === "string" ? params.status.message : "";
    const parsedForKey = extractProviderModelFromErrorMessage(retryMessage);
    const retryAttempt = extractRetryAttempt(params.status.attempt, retryMessage);
    const retryKey = `${retryAttempt}:${parsedForKey.providerID ?? ""}/${parsedForKey.modelID ?? ""}:${normalizeRetryStatusMessage(retryMessage)}`;
    if (lastHandledRetryStatusKey.get(params.sessionID) === retryKey) return true;
    lastHandledRetryStatusKey.set(params.sessionID, retryKey);

    if (!shouldRetryError({ name: undefined, message: retryMessage })) return false;

    const agentName = resolveFallbackAgentName({
      currentAgent: getSessionAgent(params.sessionID),
      sessionID: params.sessionID,
      mainSessionID: getMainSessionID(),
      message: retryMessage,
    });
    if (!agentName) return false;

    const parsed = extractProviderModelFromErrorMessage(retryMessage);
    const lastKnown = lastKnownModelBySession.get(params.sessionID);
    const currentProvider = continuation.resolveFallbackProviderID(params.sessionID, parsed.providerID);
    const currentModel = normalizeFallbackModelID(parsed.modelID ?? lastKnown?.modelID ?? "claude-opus-4-7");
    const fallbackContext = { agentName, providerID: currentProvider, dedupeProviderID: parsed.providerID, modelID: currentModel };
    const shouldAutoContinue = args.shouldAutoRetrySession(params.sessionID) && !args.isSessionStopped(params.sessionID);

    await applyFallback(
      params.sessionID,
      "session.status",
      agentName,
      currentProvider,
      currentModel,
      shouldAutoContinue,
      fallbackContext,
    );
    return false;
  };

  const handleSessionError = async (params: {
    sessionID: string;
    errorMessage: string;
    errorName?: string;
    props?: Record<string, unknown>;
  }): Promise<void> => {
    if (!shouldHandleModelFallback() || !shouldRetryError({ name: params.errorName, message: params.errorMessage })) return;

    const agentName = resolveFallbackAgentName({
      currentAgent: getSessionAgent(params.sessionID),
      sessionID: params.sessionID,
      mainSessionID: getMainSessionID(),
      message: params.errorMessage,
    });
    if (!agentName) return;

    const parsed = extractProviderModelFromErrorMessage(params.errorMessage);
    const providerHint = (params.props?.providerID as string | undefined) || parsed.providerID;
    const currentProvider = continuation.resolveFallbackProviderID(params.sessionID, providerHint);
    const currentModel = normalizeFallbackModelID(
      (params.props?.modelID as string | undefined) || parsed.modelID || "claude-opus-4-7",
    );
    const fallbackContext = { agentName, providerID: currentProvider, dedupeProviderID: providerHint, modelID: currentModel };
    const shouldAutoContinue = args.shouldAutoRetrySession(params.sessionID) && !args.isSessionStopped(params.sessionID);

    await applyFallback(
      params.sessionID,
      "session.error",
      agentName,
      currentProvider,
      currentModel,
      shouldAutoContinue,
      fallbackContext,
    );
  };

  return {
    clearRetryDedupeAfterIdle,
    clearSession,
    handleAssistantMessageUpdated,
    handleSessionError,
    handleSessionStatus,
    setLastKnownModel,
  };
}
