import type { OhMyOpenCodeConfig } from "../config";
import type { PluginContext } from "./types";

import {
  clearSessionAgent,
  getMainSessionID,
  getSessionAgent,
  setMainSession,
  subagentSessions,
  syncSubagentSessions,
  updateSessionAgent,
} from "../features/claude-code-session-state";
import {
  clearPendingModelFallback,
  clearSessionFallbackChain,
  setSessionFallbackChain,
  setPendingModelFallback,
} from "../hooks/model-fallback/hook";
import { getRawFallbackModels } from "../hooks/runtime-fallback/fallback-models";
import {
  clearBackgroundOutputConsumptionsForParentSession,
  clearBackgroundOutputConsumptionsForTaskSession,
  restoreBackgroundOutputConsumption,
} from "../shared/background-output-consumption";
import { resetMessageCursor } from "../shared";
import { getAgentConfigKey } from "../shared/agent-display-names";
import { readConnectedProvidersCache } from "../shared/connected-providers-cache";
import { log } from "../shared/logger";
import { shouldRetryError } from "../shared/model-error-classifier";
import { buildFallbackChainFromModels } from "../shared/fallback-chain-from-models";
import { extractRetryAttempt, normalizeRetryStatusMessage } from "../shared/retry-status-utils";
import { clearSessionModel, getSessionModel, setSessionModel } from "../shared/session-model-state";
import { clearSessionPromptParams } from "../shared/session-prompt-params-state";
import { deleteSessionTools } from "../shared/session-tools-store";
import { lspManager } from "../tools";

import type { CreatedHooks } from "../create-hooks";
import type { Managers } from "../create-managers";
import { isTmuxIntegrationEnabled } from "../create-runtime-tmux-config";
import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles";
import { normalizeSessionStatusToIdle } from "./session-status-normalizer";

type FirstMessageVariantGate = {
  markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void;
  clear: (sessionID: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeFallbackModelID(modelID: string): string {
  return modelID
    .replace(/-thinking$/i, "")
    .replace(/-max$/i, "")
    .replace(/-high$/i, "");
}

function extractErrorName(error: unknown): string | undefined {
  if (isRecord(error) && typeof error.name === "string") return error.name;
  if (error instanceof Error) return error.name;
  return undefined;
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;

  if (isRecord(error)) {
    const candidates: unknown[] = [
      error,
      error.data,
      error.error,
      isRecord(error.data) ? error.data.error : undefined,
      error.cause,
    ];

    for (const candidate of candidates) {
      if (isRecord(candidate) && typeof candidate.message === "string" && candidate.message.length > 0) {
        return candidate.message;
      }
    }
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function extractProviderModelFromErrorMessage(message: string): { providerID?: string; modelID?: string } {
  const lower = message.toLowerCase();

  const providerModel = lower.match(/model\s+not\s+found:\s*([a-z0-9_-]+)\s*\/\s*([a-z0-9._-]+)/i);
  if (providerModel) {
    return {
      providerID: providerModel[1],
      modelID: providerModel[2],
    };
  }

  const modelOnly = lower.match(/unknown\s+provider\s+for\s+model\s+([a-z0-9._-]+)/i);
  if (modelOnly) {
    return {
      modelID: modelOnly[1],
    };
  }

  return {};
}
function applyUserConfiguredFallbackChain(
  sessionID: string,
  agentName: string,
  currentProviderID: string,
  pluginConfig: OhMyOpenCodeConfig,
): void {
  const agentKey = getAgentConfigKey(agentName);
  const rawFallbackModels = getRawFallbackModels(sessionID, agentKey, pluginConfig);
  if (!rawFallbackModels || rawFallbackModels.length === 0) return;

  const fallbackChain = buildFallbackChainFromModels(rawFallbackModels, currentProviderID);

  if (fallbackChain && fallbackChain.length > 0) {
    setSessionFallbackChain(sessionID, fallbackChain);
  }
}

function isCompactionAgent(agent: string): boolean {
  return agent.toLowerCase() === "compaction";
}

type EventInput = Parameters<NonNullable<NonNullable<CreatedHooks["writeExistingFileGuard"]>["event"]>>[0];
export function createEventHandler(args: {
  ctx: PluginContext;
  pluginConfig: OhMyOpenCodeConfig;
  firstMessageVariantGate: FirstMessageVariantGate;
  managers: Managers;
  hooks: CreatedHooks;
}): (input: EventInput) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, managers, hooks } = args;
  const tmuxIntegrationEnabled = isTmuxIntegrationEnabled(pluginConfig)
  const pluginContext = ctx as {
    directory: string;
    client: {
      session: {
        abort: (input: { path: { id: string } }) => Promise<unknown>;
        promptAsync?: (input: {
          path: { id: string };
          body: { parts: Array<{ type: "text"; text: string }> };
          query: { directory: string };
        }) => Promise<unknown>;
        prompt: (input: {
          path: { id: string };
          body: { parts: Array<{ type: "text"; text: string }> };
          query: { directory: string };
        }) => Promise<unknown>;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        summarize: (...args: any[]) => Promise<unknown>;
      };
    };
  };
  const isRuntimeFallbackEnabled =
    hooks.runtimeFallback !== null &&
    hooks.runtimeFallback !== undefined &&
    (typeof args.pluginConfig.runtime_fallback === "boolean"
      ? args.pluginConfig.runtime_fallback
      : (args.pluginConfig.runtime_fallback?.enabled ?? false));

  const isModelFallbackEnabled =
    hooks.modelFallback !== null && hooks.modelFallback !== undefined;

  // Avoid triggering multiple abort+continue cycles for the same failing assistant message.
  const lastHandledModelErrorMessageID = new Map<string, string>();
  const lastHandledRetryStatusKey = new Map<string, string>();
  const lastKnownModelBySession = new Map<string, { providerID: string; modelID: string }>();

  const resolveFallbackProviderID = (sessionID: string, providerHint?: string): string => {
    const sessionModel = getSessionModel(sessionID);
    if (sessionModel?.providerID) {
      return sessionModel.providerID;
    }

    const lastKnownModel = lastKnownModelBySession.get(sessionID);
    if (lastKnownModel?.providerID) {
      return lastKnownModel.providerID;
    }

    const normalizedProviderHint = providerHint?.trim();
    if (normalizedProviderHint) {
      return normalizedProviderHint;
    }

    const connectedProvider = readConnectedProvidersCache()?.[0];
    if (connectedProvider) {
      return connectedProvider;
    }

    return "opencode";
  };

  const getEventSessionID = (input: EventInput): string | undefined => {
    const properties = input.event.properties;
    if (
      !properties ||
      typeof properties !== "object" ||
      !("sessionID" in properties) ||
      typeof properties.sessionID !== "string"
    ) {
      return undefined;
    }
    return properties.sessionID;
  };

  const runEventHookSafely = async (
    hookName: string,
    handler: ((input: EventInput) => unknown | Promise<unknown>) | null | undefined,
    input: EventInput,
  ): Promise<void> => {
    if (!handler) return;

    try {
      await Promise.resolve(handler(input));
    } catch (error) {
      log("[event] hook execution failed", {
        hook: hookName,
        eventType: input.event.type,
        sessionID: getEventSessionID(input),
        error,
      });
    }
  };

  const dispatchToHooks = async (input: EventInput): Promise<void> => {
    await runEventHookSafely("autoUpdateChecker", hooks.autoUpdateChecker?.event, input);
    await runEventHookSafely("legacyPluginToast", hooks.legacyPluginToast?.event, input);
    await runEventHookSafely("claudeCodeHooks", hooks.claudeCodeHooks?.event, input);
    await runEventHookSafely("backgroundNotificationHook", hooks.backgroundNotificationHook?.event, input);
    await runEventHookSafely("sessionNotification", hooks.sessionNotification, input);
    await runEventHookSafely("todoContinuationEnforcer", hooks.todoContinuationEnforcer?.handler, input);
    await runEventHookSafely("unstableAgentBabysitter", hooks.unstableAgentBabysitter?.event, input);
    await runEventHookSafely("contextWindowMonitor", hooks.contextWindowMonitor?.event, input);
    await runEventHookSafely("preemptiveCompaction", hooks.preemptiveCompaction?.event, input);
    await runEventHookSafely("directoryAgentsInjector", hooks.directoryAgentsInjector?.event, input);
    await runEventHookSafely("directoryReadmeInjector", hooks.directoryReadmeInjector?.event, input);
    await runEventHookSafely("rulesInjector", hooks.rulesInjector?.event, input);
    await runEventHookSafely("thinkMode", hooks.thinkMode?.event, input);
    await runEventHookSafely(
      "anthropicContextWindowLimitRecovery",
      hooks.anthropicContextWindowLimitRecovery?.event,
      input,
    );
    await runEventHookSafely("runtimeFallback", hooks.runtimeFallback?.event, input);
    await runEventHookSafely("agentUsageReminder", hooks.agentUsageReminder?.event, input);
    await runEventHookSafely("categorySkillReminder", hooks.categorySkillReminder?.event, input);
    await runEventHookSafely("interactiveBashSession", hooks.interactiveBashSession?.event, input as EventInput);
    await runEventHookSafely("ralphLoop", hooks.ralphLoop?.event, input);
    await runEventHookSafely("stopContinuationGuard", hooks.stopContinuationGuard?.event, input);
    await runEventHookSafely("compactionContextInjector", hooks.compactionContextInjector?.event, input);
    await runEventHookSafely("compactionTodoPreserver", hooks.compactionTodoPreserver?.event, input);
    await runEventHookSafely("writeExistingFileGuard", hooks.writeExistingFileGuard?.event, input);
    await runEventHookSafely("atlasHook", hooks.atlasHook?.handler, input);
    await runEventHookSafely("autoSlashCommand", hooks.autoSlashCommand?.event, input);
  };

  const recentSyntheticIdles = new Map<string, number>();
  const recentRealIdles = new Map<string, number>();
  const DEDUP_WINDOW_MS = 500;
  const TMUX_ACTIVITY_EVENT_TYPES = new Set([
    "message.updated",
    "message.part.updated",
    "message.part.delta",
    "message.part.removed",
    "message.removed",
  ]);

  const shouldAutoRetrySession = (sessionID: string): boolean => {
    if (syncSubagentSessions.has(sessionID)) return true;
    const mainSessionID = getMainSessionID();
    if (mainSessionID) return sessionID === mainSessionID;
    // Headless runs (or resumed sessions) may not emit session.created, so mainSessionID can be unset.
    // In that case, treat any non-subagent session as the "main" interactive session.
    return !subagentSessions.has(sessionID);
  };

  const autoContinueAfterFallback = async (sessionID: string, source: string): Promise<void> => {
    await pluginContext.client.session.abort({ path: { id: sessionID } }).catch((error) => {
      log("[event] model-fallback abort failed", { sessionID, source, error });
    });

    const promptBody = {
      path: { id: sessionID },
      body: { parts: [{ type: "text" as const, text: "continue" }] },
      query: { directory: pluginContext.directory },
    };

    if (typeof pluginContext.client.session.promptAsync === "function") {
      await pluginContext.client.session.promptAsync(promptBody).catch((error) => {
        log("[event] model-fallback promptAsync failed", { sessionID, source, error });
      });
      return;
    }

    await pluginContext.client.session.prompt(promptBody).catch((error) => {
      log("[event] model-fallback prompt failed", { sessionID, source, error });
    });
  };

  return async (input): Promise<void> => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      now: Date.now(),
      dedupWindowMs: DEDUP_WINDOW_MS,
    });

    if (input.event.type === "session.idle") {
      const sessionID = (input.event.properties as Record<string, unknown> | undefined)?.sessionID as
        | string
        | undefined;
      if (sessionID) {
        const emittedAt = recentSyntheticIdles.get(sessionID);
        if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
          recentSyntheticIdles.delete(sessionID);
          return;
        }
        recentRealIdles.set(sessionID, Date.now());
      }
    }

    await dispatchToHooks(input);

    const syntheticIdle = normalizeSessionStatusToIdle(input);
    if (syntheticIdle) {
      const sessionID = (syntheticIdle.event.properties as Record<string, unknown>)?.sessionID as string;
      const emittedAt = recentRealIdles.get(sessionID);
      if (emittedAt && Date.now() - emittedAt < DEDUP_WINDOW_MS) {
        recentRealIdles.delete(sessionID);
        return;
      }
      recentSyntheticIdles.set(sessionID, Date.now());
      await dispatchToHooks(syntheticIdle as EventInput);
    }

    const { event } = input;
    const props = event.properties as Record<string, unknown> | undefined;

    if (tmuxIntegrationEnabled && TMUX_ACTIVITY_EVENT_TYPES.has(event.type)) {
      managers.tmuxSessionManager.onEvent?.(event as { type: string; properties?: Record<string, unknown> });
    }

    if (event.type === "session.created") {
      const sessionInfo = props?.info as { id?: string; title?: string; parentID?: string } | undefined;

      if (!sessionInfo?.parentID) {
        setMainSession(sessionInfo?.id);
      }

      firstMessageVariantGate.markSessionCreated(sessionInfo);

      if (tmuxIntegrationEnabled) {
        await managers.tmuxSessionManager.onSessionCreated(
          event as {
            type: string;
            properties?: {
              info?: { id?: string; parentID?: string; title?: string };
            };
          },
        );
      }
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id === getMainSessionID()) {
        setMainSession(undefined);
      }

      if (sessionInfo?.id) {
        const wasSyncSubagentSession = syncSubagentSessions.has(sessionInfo.id);
        clearSessionAgent(sessionInfo.id);
        lastHandledModelErrorMessageID.delete(sessionInfo.id);
        lastHandledRetryStatusKey.delete(sessionInfo.id);
        lastKnownModelBySession.delete(sessionInfo.id);
        clearPendingModelFallback(sessionInfo.id);
        clearSessionFallbackChain(sessionInfo.id);
        resetMessageCursor(sessionInfo.id);
        clearBackgroundOutputConsumptionsForParentSession(sessionInfo.id);
        clearBackgroundOutputConsumptionsForTaskSession(sessionInfo.id);
        firstMessageVariantGate.clear(sessionInfo.id);
        clearSessionModel(sessionInfo.id);
        clearSessionPromptParams(sessionInfo.id);
        syncSubagentSessions.delete(sessionInfo.id);
        if (wasSyncSubagentSession) {
          subagentSessions.delete(sessionInfo.id);
        }
        deleteSessionTools(sessionInfo.id);
        await managers.skillMcpManager.disconnectSession(sessionInfo.id);
        await lspManager.cleanupTempDirectoryClients();
        if (tmuxIntegrationEnabled) {
          await managers.tmuxSessionManager.onSessionDeleted({
            sessionID: sessionInfo.id,
          });
        }
      }
    }

    if (event.type === "message.removed") {
      const messageID = props?.messageID as string | undefined;
      const sessionID = props?.sessionID as string | undefined;
      restoreBackgroundOutputConsumption(sessionID, messageID);
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined;
      const sessionID = info?.sessionID as string | undefined;
      const agent = info?.agent as string | undefined;
      const role = info?.role as string | undefined;
      if (sessionID && role === "user") {
        const isCompactionMessage = agent ? isCompactionAgent(agent) : false;
        if (agent && !isCompactionMessage) {
          updateSessionAgent(sessionID, agent);
        }
        const providerID = info?.providerID as string | undefined;
        const modelID = info?.modelID as string | undefined;
        if (providerID && modelID && !isCompactionMessage) {
          lastKnownModelBySession.set(sessionID, { providerID, modelID });
          setSessionModel(sessionID, { providerID, modelID });
        }
      }

      // Model fallback: in practice, API/model failures often surface as assistant message errors.
      // session.error events are not guaranteed for all providers, so we also observe message.updated.
      if (sessionID && role === "assistant" && !isRuntimeFallbackEnabled && isModelFallbackEnabled) {
        try {
          const assistantMessageID = info?.id as string | undefined;
          const assistantError = info?.error;
          if (assistantMessageID && assistantError) {
            const lastHandled = lastHandledModelErrorMessageID.get(sessionID);
            if (lastHandled === assistantMessageID) {
              return;
            }

            const errorName = extractErrorName(assistantError);
            const errorMessage = extractErrorMessage(assistantError);
            const errorInfo = { name: errorName, message: errorMessage };

            if (shouldRetryError(errorInfo)) {
              // Prefer the agent/model/provider from the assistant message payload.
              let agentName = agent ?? getSessionAgent(sessionID);
              if (!agentName && sessionID === getMainSessionID()) {
                if (errorMessage.includes("claude-opus") || errorMessage.includes("opus")) {
                  agentName = "sisyphus";
                } else if (errorMessage.includes("gpt-5")) {
                  agentName = "hephaestus";
                } else {
                  agentName = "sisyphus";
                }
              }

              if (agentName) {
                const currentProvider = resolveFallbackProviderID(
                  sessionID,
                  info?.providerID as string | undefined,
                );
                const rawModel = (info?.modelID as string | undefined) ?? "claude-opus-4-6";
                const currentModel = normalizeFallbackModelID(rawModel);
                applyUserConfiguredFallbackChain(sessionID, agentName, currentProvider, args.pluginConfig);

                const setFallback = setPendingModelFallback(sessionID, agentName, currentProvider, currentModel);

                if (
                  setFallback &&
                  shouldAutoRetrySession(sessionID) &&
                  !hooks.stopContinuationGuard?.isStopped(sessionID)
                ) {
                  lastHandledModelErrorMessageID.set(sessionID, assistantMessageID);
                  await autoContinueAfterFallback(sessionID, "message.updated");
                }
              }
            }
          }
        } catch (err) {
          log("[event] model-fallback error in message.updated:", { sessionID, error: err });
        }
      }
    }

    if (event.type === "session.status") {
      const sessionID = props?.sessionID as string | undefined;
      const status = props?.status as { type?: string; attempt?: number; message?: string; next?: number } | undefined;

      // Retry dedupe lifecycle: set key when a retry status is handled, clear it after recovery
      // (non-retry idle) so future failures with the same key can trigger fallback again.
      if (sessionID && status?.type === "idle") {
        lastHandledRetryStatusKey.delete(sessionID);
      }

      if (sessionID && status?.type === "retry" && isModelFallbackEnabled && !isRuntimeFallbackEnabled) {
        try {
          const retryMessage = typeof status.message === "string" ? status.message : "";
          const parsedForKey = extractProviderModelFromErrorMessage(retryMessage);
          const retryAttempt = extractRetryAttempt(status.attempt, retryMessage);
          // Deduplicate countdown updates for the same retry attempt/model.
          // Messages like "retrying in 7m 56s" change every second but should only trigger once.
          const retryKey = `${retryAttempt}:${parsedForKey.providerID ?? ""}/${parsedForKey.modelID ?? ""}:${normalizeRetryStatusMessage(retryMessage)}`;
          if (lastHandledRetryStatusKey.get(sessionID) === retryKey) {
            return;
          }
          lastHandledRetryStatusKey.set(sessionID, retryKey);

          const errorInfo = { name: undefined as string | undefined, message: retryMessage };
          if (shouldRetryError(errorInfo)) {
            let agentName = getSessionAgent(sessionID);
            if (!agentName && sessionID === getMainSessionID()) {
              if (retryMessage.includes("claude-opus") || retryMessage.includes("opus")) {
                agentName = "sisyphus";
              } else if (retryMessage.includes("gpt-5")) {
                agentName = "hephaestus";
              } else {
                agentName = "sisyphus";
              }
            }

            if (agentName) {
              const parsed = extractProviderModelFromErrorMessage(retryMessage);
              const lastKnown = lastKnownModelBySession.get(sessionID);
              const currentProvider = resolveFallbackProviderID(sessionID, parsed.providerID);
              let currentModel = parsed.modelID ?? lastKnown?.modelID ?? "claude-opus-4-6";
              currentModel = normalizeFallbackModelID(currentModel);
              applyUserConfiguredFallbackChain(sessionID, agentName, currentProvider, args.pluginConfig);

              const setFallback = setPendingModelFallback(sessionID, agentName, currentProvider, currentModel);

              if (
                setFallback &&
                shouldAutoRetrySession(sessionID) &&
                !hooks.stopContinuationGuard?.isStopped(sessionID)
              ) {
                await autoContinueAfterFallback(sessionID, "session.status");
              }
            }
          }
        } catch (err) {
          log("[event] model-fallback error in session.status:", { sessionID, error: err });
        }
      }
    }

    if (event.type === "session.error") {
      try {
        const sessionID = props?.sessionID as string | undefined;
        const error = props?.error;

        const errorName = extractErrorName(error);
        const errorMessage = extractErrorMessage(error);
        const errorInfo = { name: errorName, message: errorMessage };

        // First, try session recovery for internal errors (thinking blocks, tool results, etc.)
        if (hooks.sessionRecovery?.isRecoverableError(error)) {
          const messageInfo = {
            id: props?.messageID as string | undefined,
            role: "assistant" as const,
            sessionID,
            error,
          };
          const recovered = await hooks.sessionRecovery.handleSessionRecovery(messageInfo);

          if (
            recovered &&
            sessionID &&
            sessionID === getMainSessionID() &&
            !hooks.stopContinuationGuard?.isStopped(sessionID)
          ) {
            // Trigger compaction before sending "continue" to avoid double-sending continuation
            await pluginContext.client.session
              .summarize({
                path: { id: sessionID },
                body: { auto: true },
                query: { directory: pluginContext.directory },
              })
              .catch((err: unknown) => {
                log("[event] compaction before recovery continue failed:", { sessionID, error: err });
              });

            await pluginContext.client.session
              .prompt({
                path: { id: sessionID },
                body: { parts: [{ type: "text", text: "continue" }] },
                query: { directory: pluginContext.directory },
              })
              .catch(() => {});
          }
        }
        // Second, try model fallback for model errors (rate limit, quota, provider issues, etc.)
        else if (sessionID && shouldRetryError(errorInfo) && !isRuntimeFallbackEnabled && isModelFallbackEnabled) {
          let agentName = getSessionAgent(sessionID);

          if (!agentName && sessionID === getMainSessionID()) {
            if (errorMessage.includes("claude-opus") || errorMessage.includes("opus")) {
              agentName = "sisyphus";
            } else if (errorMessage.includes("gpt-5")) {
              agentName = "hephaestus";
            } else {
              agentName = "sisyphus";
            }
          }

          if (agentName) {
            const parsed = extractProviderModelFromErrorMessage(errorMessage);
            const currentProvider = resolveFallbackProviderID(
              sessionID,
              (props?.providerID as string | undefined) || parsed.providerID,
            );
            let currentModel = (props?.modelID as string) || parsed.modelID || "claude-opus-4-6";
            currentModel = normalizeFallbackModelID(currentModel);
            applyUserConfiguredFallbackChain(sessionID, agentName, currentProvider, args.pluginConfig);

            const setFallback = setPendingModelFallback(sessionID, agentName, currentProvider, currentModel);

            if (
              setFallback &&
              shouldAutoRetrySession(sessionID) &&
              !hooks.stopContinuationGuard?.isStopped(sessionID)
            ) {
              await autoContinueAfterFallback(sessionID, "session.error");
            }
          }
        }
      } catch (err) {
        const sessionID = props?.sessionID as string | undefined;
        log("[event] model-fallback error in session.error:", { sessionID, error: err });
      }
    }
  };
}
