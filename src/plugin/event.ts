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
  setPendingModelFallback,
} from "../hooks/model-fallback/hook";
import { resetMessageCursor } from "../shared";
import { log } from "../shared/logger";
import { shouldRetryError } from "../shared/model-error-classifier";
import { clearSessionModel, setSessionModel } from "../shared/session-model-state";
import { deleteSessionTools } from "../shared/session-tools-store";
import { lspManager } from "../tools";

import type { CreatedHooks } from "../create-hooks";
import type { Managers } from "../create-managers";
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
type EventInput = Parameters<NonNullable<NonNullable<CreatedHooks["writeExistingFileGuard"]>["event"]>>[0];
export function createEventHandler(args: {
  ctx: PluginContext;
  pluginConfig: OhMyOpenCodeConfig;
  firstMessageVariantGate: FirstMessageVariantGate;
  managers: Managers;
  hooks: CreatedHooks;
}): (input: EventInput) => Promise<void> {
  const { ctx, firstMessageVariantGate, managers, hooks } = args;
  const pluginContext = ctx as {
    directory: string;
    client: {
      session: {
        abort: (input: { path: { id: string } }) => Promise<unknown>;
        prompt: (input: {
          path: { id: string };
          body: { parts: Array<{ type: "text"; text: string }> };
          query: { directory: string };
        }) => Promise<unknown>;
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

  // Event subscriptions: which event types each hook cares about.
  // Hooks mapped to string[] only fire for those event types; "*" fires for all.
  // Unlisted hooks default to "*" (backward compat).
  const SESSION_LIFECYCLE = ["session.idle", "session.created", "session.deleted", "session.status", "session.error", "session.updated"];
  const MESSAGE_EVENTS = ["message.updated", "message.part.updated"];
  const HOOK_SUBSCRIPTIONS: Record<string, string[] | "*"> = {
    // ALL events including deltas (transcript tracking, streaming output monitoring)
    claudeCodeHooks: "*",
    interactiveBashSession: "*",
    // Session lifecycle only
    sessionNotification: SESSION_LIFECYCLE,
    unstableAgentBabysitter: SESSION_LIFECYCLE,
    runtimeFallback: SESSION_LIFECYCLE,
    agentUsageReminder: SESSION_LIFECYCLE,
    categorySkillReminder: SESSION_LIFECYCLE,
    ralphLoop: SESSION_LIFECYCLE,
    stopContinuationGuard: SESSION_LIFECYCLE,
    backgroundNotificationHook: SESSION_LIFECYCLE,
    autoUpdateChecker: SESSION_LIFECYCLE,
    // Message events (no deltas)
    contextWindowMonitor: [...MESSAGE_EVENTS, "session.status"],
    anthropicContextWindowLimitRecovery: MESSAGE_EVENTS,
    compactionTodoPreserver: MESSAGE_EVENTS,
    writeExistingFileGuard: MESSAGE_EVENTS,
    todoContinuationEnforcer: MESSAGE_EVENTS,
    atlasHook: MESSAGE_EVENTS,
    // Chat-level events
    directoryAgentsInjector: ["session.created", "message.updated"],
    directoryReadmeInjector: ["session.created", "message.updated"],
    rulesInjector: ["session.created", "message.updated"],
    thinkMode: ["session.created", "message.updated"],
  };

  // Hooks that MUST be awaited (order-dependent or mutate state read by later hooks)
  const AWAITED_HOOKS = new Set(["claudeCodeHooks", "stopContinuationGuard", "writeExistingFileGuard"]);

  // Build dispatch entries once: [name, invokeFn, subscriptions]
  type HookInvoker = (input: EventInput) => unknown;
  const hookEntries: Array<[string, HookInvoker, string[] | "*"]> = ([
    ["autoUpdateChecker", (i: EventInput) => hooks.autoUpdateChecker?.event?.(i)] as const,
    ["claudeCodeHooks", (i: EventInput) => hooks.claudeCodeHooks?.event?.(i)] as const,
    ["backgroundNotificationHook", (i: EventInput) => hooks.backgroundNotificationHook?.event?.(i)] as const,
    ["sessionNotification", (i: EventInput) => hooks.sessionNotification?.(i)] as const,
    ["todoContinuationEnforcer", (i: EventInput) => hooks.todoContinuationEnforcer?.handler?.(i)] as const,
    ["unstableAgentBabysitter", (i: EventInput) => hooks.unstableAgentBabysitter?.event?.(i)] as const,
    ["contextWindowMonitor", (i: EventInput) => hooks.contextWindowMonitor?.event?.(i)] as const,
    ["directoryAgentsInjector", (i: EventInput) => hooks.directoryAgentsInjector?.event?.(i)] as const,
    ["directoryReadmeInjector", (i: EventInput) => hooks.directoryReadmeInjector?.event?.(i)] as const,
    ["rulesInjector", (i: EventInput) => hooks.rulesInjector?.event?.(i)] as const,
    ["thinkMode", (i: EventInput) => hooks.thinkMode?.event?.(i)] as const,
    ["anthropicContextWindowLimitRecovery", (i: EventInput) => hooks.anthropicContextWindowLimitRecovery?.event?.(i)] as const,
    ["runtimeFallback", (i: EventInput) => hooks.runtimeFallback?.event?.(i)] as const,
    ["agentUsageReminder", (i: EventInput) => hooks.agentUsageReminder?.event?.(i)] as const,
    ["categorySkillReminder", (i: EventInput) => hooks.categorySkillReminder?.event?.(i)] as const,
    ["interactiveBashSession", (i: EventInput) => hooks.interactiveBashSession?.event?.(i as EventInput)] as const,
    ["ralphLoop", (i: EventInput) => hooks.ralphLoop?.event?.(i)] as const,
    ["stopContinuationGuard", (i: EventInput) => hooks.stopContinuationGuard?.event?.(i)] as const,
    ["compactionTodoPreserver", (i: EventInput) => hooks.compactionTodoPreserver?.event?.(i)] as const,
    ["writeExistingFileGuard", (i: EventInput) => hooks.writeExistingFileGuard?.event?.(i)] as const,
    ["atlasHook", (i: EventInput) => hooks.atlasHook?.handler?.(i)] as const,
  ] as [string, HookInvoker][]).map(([name, fn]) => [name, fn, HOOK_SUBSCRIPTIONS[name] ?? "*"] as [string, HookInvoker, string[] | "*"]);

  const dispatchToHooks = async (input: EventInput): Promise<void> => {
    const eventType = input.event.type;
    for (const [name, invoke, subs] of hookEntries) {
      if (subs !== "*" && !subs.includes(eventType)) continue;
      if (AWAITED_HOOKS.has(name)) {
        await Promise.resolve(invoke(input));
      } else {
        Promise.resolve(invoke(input)).catch((err) => log("[hook] error:", { hook: name, error: err }));
      }
    }
  };

  const recentSyntheticIdles = new Map<string, number>();
  const recentRealIdles = new Map<string, number>();
  const DEDUP_WINDOW_MS = 500;

  const shouldAutoRetrySession = (sessionID: string): boolean => {
    if (syncSubagentSessions.has(sessionID)) return true;
    const mainSessionID = getMainSessionID();
    if (mainSessionID) return sessionID === mainSessionID;
    // Headless runs (or resumed sessions) may not emit session.created, so mainSessionID can be unset.
    // In that case, treat any non-subagent session as the "main" interactive session.
    return !subagentSessions.has(sessionID);
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

    if (event.type === "session.created") {
      const sessionInfo = props?.info as { id?: string; title?: string; parentID?: string } | undefined;

      if (!sessionInfo?.parentID) {
        setMainSession(sessionInfo?.id);
      }

      firstMessageVariantGate.markSessionCreated(sessionInfo);

      await managers.tmuxSessionManager.onSessionCreated(
        event as {
          type: string;
          properties?: {
            info?: { id?: string; parentID?: string; title?: string };
          };
        },
      );
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined;
      if (sessionInfo?.id === getMainSessionID()) {
        setMainSession(undefined);
      }

      if (sessionInfo?.id) {
        clearSessionAgent(sessionInfo.id);
        lastHandledModelErrorMessageID.delete(sessionInfo.id);
        lastHandledRetryStatusKey.delete(sessionInfo.id);
        lastKnownModelBySession.delete(sessionInfo.id);
        clearPendingModelFallback(sessionInfo.id);
        clearSessionFallbackChain(sessionInfo.id);
        resetMessageCursor(sessionInfo.id);
        firstMessageVariantGate.clear(sessionInfo.id);
        clearSessionModel(sessionInfo.id);
        syncSubagentSessions.delete(sessionInfo.id);
        deleteSessionTools(sessionInfo.id);
        await managers.skillMcpManager.disconnectSession(sessionInfo.id);
        await lspManager.cleanupTempDirectoryClients();
        await managers.tmuxSessionManager.onSessionDeleted({
          sessionID: sessionInfo.id,
        });
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined;
      const sessionID = info?.sessionID as string | undefined;
      const agent = info?.agent as string | undefined;
      const role = info?.role as string | undefined;
      if (sessionID && role === "user") {
        if (agent) {
          updateSessionAgent(sessionID, agent);
        }
        const providerID = info?.providerID as string | undefined;
        const modelID = info?.modelID as string | undefined;
        if (providerID && modelID) {
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
                const currentProvider = (info?.providerID as string | undefined) ?? "opencode";
                const rawModel = (info?.modelID as string | undefined) ?? "claude-opus-4-6";
                const currentModel = normalizeFallbackModelID(rawModel);

                const setFallback = setPendingModelFallback(sessionID, agentName, currentProvider, currentModel);

                if (
                  setFallback &&
                  shouldAutoRetrySession(sessionID) &&
                  !hooks.stopContinuationGuard?.isStopped(sessionID)
                ) {
                  lastHandledModelErrorMessageID.set(sessionID, assistantMessageID);

                  await pluginContext.client.session.abort({ path: { id: sessionID } }).catch(() => {});
                  await pluginContext.client.session
                    .prompt({
                      path: { id: sessionID },
                      body: { parts: [{ type: "text", text: "continue" }] },
                      query: { directory: pluginContext.directory },
                    })
                    .catch(() => {});
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

      if (sessionID && status?.type === "retry" && isModelFallbackEnabled) {
        try {
          const retryMessage = typeof status.message === "string" ? status.message : "";
          const retryKey = `${status.attempt ?? "?"}:${status.next ?? "?"}:${retryMessage}`;
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
              const currentProvider = parsed.providerID ?? lastKnown?.providerID ?? "opencode";
              let currentModel = parsed.modelID ?? lastKnown?.modelID ?? "claude-opus-4-6";
              currentModel = normalizeFallbackModelID(currentModel);

              const setFallback = setPendingModelFallback(sessionID, agentName, currentProvider, currentModel);

              if (
                setFallback &&
                shouldAutoRetrySession(sessionID) &&
                !hooks.stopContinuationGuard?.isStopped(sessionID)
              ) {
                await pluginContext.client.session.abort({ path: { id: sessionID } }).catch(() => {});
                await pluginContext.client.session
                  .prompt({
                    path: { id: sessionID },
                    body: { parts: [{ type: "text", text: "continue" }] },
                    query: { directory: pluginContext.directory },
                  })
                  .catch(() => {});
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
            const currentProvider = (props?.providerID as string) || parsed.providerID || "opencode";
            let currentModel = (props?.modelID as string) || parsed.modelID || "claude-opus-4-6";
            currentModel = normalizeFallbackModelID(currentModel);

            const setFallback = setPendingModelFallback(sessionID, agentName, currentProvider, currentModel);

            if (
              setFallback &&
              shouldAutoRetrySession(sessionID) &&
              !hooks.stopContinuationGuard?.isStopped(sessionID)
            ) {
              await pluginContext.client.session.abort({ path: { id: sessionID } }).catch(() => {});

              await pluginContext.client.session
                .prompt({
                  path: { id: sessionID },
                  body: { parts: [{ type: "text", text: "continue" }] },
                  query: { directory: pluginContext.directory },
                })
                .catch(() => {});
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
