import type { PluginInput } from "@opencode-ai/plugin";
import type { OhMyOpenCodeConfig } from "../config";
import type { CreatedHooks } from "../create-hooks";
import type { Managers } from "../create-managers";
import type { PluginContext } from "./types";

import { getMainSessionID, subagentSessions, syncSubagentSessions } from "../features/claude-code-session-state";
import { invalidateContextWindowUsageCache } from "../shared/dynamic-truncator";
import { resolveSessionEventID } from "../shared/event-session-id";
import { log } from "../shared/logger";
import { normalizeSessionStatusToIdle } from "./session-status-normalizer";
import { pruneRecentSyntheticIdles } from "./recent-synthetic-idles";
import { extractErrorMessage, extractErrorName } from "./event-error-utils";
import { createEventHookDispatcher, createEventHookRunner, getEventSessionID } from "./event-hook-dispatcher";
import { createModelFallbackEventHandler } from "./event-model-fallback";
import { createSessionLifecycleQueue } from "./event-session-lifecycle-queue";
import {
  dispatchOpenClawSessionEvent,
  handleMessageRemovedEvent,
  handleMessageUpdatedSessionState,
  handleSessionCreatedEvent,
  reserveSessionDeletedEvent,
  TMUX_ACTIVITY_EVENT_TYPES,
} from "./event-session-lifecycle";
import { createEventTeamHandlers } from "./event-team-handlers";
import type { EventInput, FirstMessageVariantGate, PluginEventContext } from "./event-types";

export { extractErrorMessage } from "./event-error-utils";

export function createEventHandler(args: {
  ctx: PluginContext;
  pluginConfig: OhMyOpenCodeConfig;
  firstMessageVariantGate: FirstMessageVariantGate;
  managers: Managers;
  hooks: CreatedHooks;
}): (input: EventInput) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, managers, hooks } = args;
  const tmuxIntegrationEnabled = pluginConfig.tmux?.enabled ?? false;
  const pluginContext = ctx as PluginEventContext;
  const isRuntimeFallbackEnabled =
    hooks.runtimeFallback !== null &&
    hooks.runtimeFallback !== undefined &&
    (typeof pluginConfig.runtime_fallback === "boolean"
      ? pluginConfig.runtime_fallback
      : (pluginConfig.runtime_fallback?.enabled ?? false));
  const isModelFallbackEnabled = hooks.modelFallback !== null && hooks.modelFallback !== undefined;
  const runEventHookSafely = createEventHookRunner();
  const dispatchToHooks = createEventHookDispatcher(hooks, runEventHookSafely);
  const recentSyntheticIdles = new Map<string, number>();
  const recentRealIdles = new Map<string, number>();
  const recentAnyIdles = new Map<string, number>();
  const dedupWindowMs = 500;
  const teamHandlers = createEventTeamHandlers({ pluginConfig, pluginContext, managers });
  const sessionDeletionTasks = new Map<string, Promise<void>>();
  const runSessionLifecycle = createSessionLifecycleQueue();

  const shouldAutoRetrySession = (sessionID: string): boolean => {
    if (syncSubagentSessions.has(sessionID)) return true;
    const mainSessionID = getMainSessionID();
    if (mainSessionID) return sessionID === mainSessionID;
    return !subagentSessions.has(sessionID);
  };

  const modelFallbackHandler = createModelFallbackEventHandler({
    pluginConfig,
    pluginContext,
    modelFallback: hooks.modelFallback,
    isModelFallbackEnabled,
    isRuntimeFallbackEnabled,
    shouldAutoRetrySession,
    isSessionStopped: (sessionID) => hooks.stopContinuationGuard?.isStopped(sessionID) ?? false,
  });

  const shouldDispatchIdleEvent = (sessionID: string, now: number): boolean => {
    const lastDispatchedAt = recentAnyIdles.get(sessionID);
    if (lastDispatchedAt !== undefined && now - lastDispatchedAt < dedupWindowMs) return false;
    recentAnyIdles.set(sessionID, now);
    return true;
  };

  const dispatchIdleOnlyHooks = async (input: EventInput): Promise<void> => {
    managers.tmuxSessionManager?.onEvent?.(input.event);
    await runEventHookSafely("teamIdleWakeHint", teamHandlers.teamIdleWakeHint, input);
    await runEventHookSafely("teamMemberStatusHandler", teamHandlers.teamMemberStatusHandler, input);
  };

  const dispatchSyntheticIdle = async (syntheticIdle: EventInput): Promise<void> => {
    const sessionID = (syntheticIdle.event.properties as Record<string, unknown>)?.sessionID as string;
    const now = Date.now();
    const emittedAt = recentRealIdles.get(sessionID);
    if (emittedAt !== undefined && now - emittedAt < dedupWindowMs) {
      recentRealIdles.delete(sessionID);
      return;
    }
    recentSyntheticIdles.set(sessionID, now);
    if (!shouldDispatchIdleEvent(sessionID, now)) return;

    await dispatchToHooks(syntheticIdle);
    await dispatchOpenClawSessionEvent({
      pluginConfig,
      pluginContext,
      managers,
      rawEvent: "session.idle",
      sessionID,
    });
    await dispatchIdleOnlyHooks(syntheticIdle);
  };

  const handleEvent = async (input: EventInput): Promise<void> => {
    pruneRecentSyntheticIdles({
      recentSyntheticIdles,
      recentRealIdles,
      recentAnyIdles,
      now: Date.now(),
      dedupWindowMs,
    });
    const syntheticIdle = normalizeSessionStatusToIdle(input) as EventInput | undefined;

    if (input.event.type === "session.idle") {
      const sessionID = getEventSessionID(input);
      if (sessionID) {
        modelFallbackHandler.clearRetryDedupeAfterIdle(sessionID);
        const now = Date.now();
        const emittedAt = recentSyntheticIdles.get(sessionID);
        if (emittedAt !== undefined && now - emittedAt < dedupWindowMs) recentSyntheticIdles.delete(sessionID);
      }
      if (sessionID) {
        const now = Date.now();
        recentRealIdles.set(sessionID, now);
        if (!shouldDispatchIdleEvent(sessionID, now)) return;
      }
    }

    const { event } = input;
    const props = event.properties as Record<string, unknown> | undefined;
    if (event.type === "session.created") {
      const sessionID = resolveSessionEventID(props);
      if (sessionID) await sessionDeletionTasks.get(sessionID)?.catch(() => undefined);
    }
    const deletionReservation = event.type === "session.deleted"
      ? reserveSessionDeletedEvent({
          props,
          tmuxIntegrationEnabled,
          pluginConfig,
          pluginContext,
          managers,
          firstMessageVariantGate,
          clearModelFallbackSession: modelFallbackHandler.clearSession,
          sessionDeletionTasks,
        })
      : undefined;
    await dispatchToHooks(input);
    if (syntheticIdle) await dispatchSyntheticIdle(syntheticIdle);
    deletionReservation?.start();

    managers.tuiStateMirror?.onEvent(event);

    if (tmuxIntegrationEnabled && TMUX_ACTIVITY_EVENT_TYPES.has(event.type)) {
      managers.tmuxSessionManager.onEvent?.(event as { type: string; properties?: Record<string, unknown> });
    }

    if (event.type === "session.created") {
      await handleSessionCreatedEvent({
        event,
        props,
        tmuxIntegrationEnabled,
        pluginConfig,
        pluginContext,
        managers,
        firstMessageVariantGate,
        sessionDeletionTasks,
      });
    }

    if (event.type === "session.deleted") {
      await deletionReservation?.task;
      await runEventHookSafely("teamLeadOrphanHandler", teamHandlers.teamLeadOrphanHandler, input);
      await runEventHookSafely("teamMemberStatusHandler", teamHandlers.teamMemberStatusHandler, input);
    }

    if (event.type === "message.removed") handleMessageRemovedEvent(props);

    if (event.type === "session.idle") {
      const sessionID = resolveSessionEventID(props);
      if (sessionID) {
        await dispatchOpenClawSessionEvent({ pluginConfig, pluginContext, managers, rawEvent: event.type, sessionID });
      }
      await dispatchIdleOnlyHooks(input);
      await Promise.resolve().then(() => managers.monitorManager?.handleEvent({
        type: "session.idle",
        sessionId: resolveSessionEventID(props) ?? "",
      }));
    }

    if (event.type === "message.updated") {
      const state = handleMessageUpdatedSessionState({
        props,
        noteSessionModel: modelFallbackHandler.setLastKnownModel,
      });
      if (state.sessionID && ((typeof state.info?.finish === "string" && state.info.finish.length > 0) || state.info?.finish === true)) {
        invalidateContextWindowUsageCache(pluginContext as PluginInput, state.sessionID);
      }
      if (state.sessionID && state.role === "assistant") {
        try {
          const shouldStop = await modelFallbackHandler.handleAssistantMessageUpdated({
            sessionID: state.sessionID,
            info: state.info ?? {},
            agent: state.agent,
          });
          if (shouldStop) return;
        } catch (err) {
          log("[event] model-fallback error in message.updated:", {
            sessionID: state.sessionID,
            error: err instanceof Error ? err : String(err),
          });
        }
      }
    }

    if (event.type === "session.status") {
      const sessionID = resolveSessionEventID(props);
      const status = props?.status as { type?: string; attempt?: number; message?: string; next?: number } | undefined;
      if (sessionID) {
        try {
          if (await modelFallbackHandler.handleSessionStatus({ sessionID, status })) return;
        } catch (err) {
          log("[event] model-fallback error in session.status:", {
            sessionID,
            error: err instanceof Error ? err : String(err),
          });
        }
      }
    }

    if (event.type === "session.error") {
      try {
        const sessionID = resolveSessionEventID(props);
        const error = props?.error;
        const errorName = extractErrorName(error);
        const errorMessage = extractErrorMessage(error);
        if (sessionID) {
          await modelFallbackHandler.handleSessionError({ sessionID, errorName, errorMessage, props });
        }
      } catch (err) {
        const sessionID = resolveSessionEventID(props);
        log("[event] model-fallback error in session.error:", {
          sessionID,
          error: err instanceof Error ? err : String(err),
        });
      }

      await runEventHookSafely("teamMemberErrorHandler", teamHandlers.teamMemberErrorHandler, input);
    }
  };

  return async (input): Promise<void> => {
    const isLifecycleEvent = input.event.type === "session.created" || input.event.type === "session.deleted";
    const sessionID = isLifecycleEvent
      ? resolveSessionEventID(input.event.properties as Record<string, unknown> | undefined)
      : undefined;
    if (!sessionID) {
      await handleEvent(input);
      return;
    }
    await runSessionLifecycle(sessionID, () => handleEvent(input));
  };
}
