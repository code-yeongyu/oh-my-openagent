import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginContext } from "../types"

import {
  createTodoContinuationEnforcer,
  createBackgroundNotificationHook,
  createStopContinuationGuardHook,
  createCompactionContextInjector,
  createCompactionTodoPreserverHook,
  createAtlasHook,
} from "../../hooks"
import { safeCreateHook } from "../../shared/safe-create-hook"
import { createUnstableAgentBabysitter } from "../unstable-agent-babysitter"

export type ContinuationHooks = {
  stopContinuationGuard: ReturnType<typeof createStopContinuationGuardHook> | null
  compactionContextInjector: ReturnType<typeof createCompactionContextInjector> | null
  compactionTodoPreserver: ReturnType<typeof createCompactionTodoPreserverHook> | null
  todoContinuationEnforcer: ReturnType<typeof createTodoContinuationEnforcer> | null
  unstableAgentBabysitter: ReturnType<typeof createUnstableAgentBabysitter> | null
  backgroundNotificationHook: ReturnType<typeof createBackgroundNotificationHook> | null
  atlasHook: ReturnType<typeof createAtlasHook> | null
}

type SessionRecovery = {
  setOnAbortCallback: (callback: (sessionID: string) => void) => void
  setOnRecoveryCompleteCallback: (callback: (sessionID: string) => void) => void
} | null

export function createContinuationHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  backgroundManager: BackgroundManager
  sessionRecovery: SessionRecovery
}): ContinuationHooks {
  const {
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager,
    sessionRecovery,
  } = args

  const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
    safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

  const stopContinuationGuard = isHookEnabled("stop-continuation-guard")
    ? safeHook("stop-continuation-guard", () => createStopContinuationGuardHook(ctx))
    : null

  const compactionContextInjector = isHookEnabled("compaction-context-injector")
    ? safeHook("compaction-context-injector", () => createCompactionContextInjector())
    : null

  const compactionTodoPreserver = isHookEnabled("compaction-todo-preserver")
    ? safeHook("compaction-todo-preserver", () => createCompactionTodoPreserverHook(ctx))
    : null

  const todoContinuationEnforcer = isHookEnabled("todo-continuation-enforcer")
    ? safeHook("todo-continuation-enforcer", () =>
        createTodoContinuationEnforcer(ctx, {
          backgroundManager,
          isContinuationStopped: stopContinuationGuard?.isStopped,
        }))
    : null

  const unstableAgentBabysitter = isHookEnabled("unstable-agent-babysitter")
    ? safeHook("unstable-agent-babysitter", () =>
        createUnstableAgentBabysitter({ ctx, backgroundManager, pluginConfig }))
    : null

  if (sessionRecovery && todoContinuationEnforcer) {
    sessionRecovery.setOnAbortCallback(todoContinuationEnforcer.markRecovering)
    sessionRecovery.setOnRecoveryCompleteCallback(todoContinuationEnforcer.markRecoveryComplete)
  }

  const backgroundNotificationHook = isHookEnabled("background-notification")
    ? safeHook("background-notification", () => createBackgroundNotificationHook(backgroundManager))
    : null

  const atlasHook = isHookEnabled("atlas")
    ? safeHook("atlas", () =>
        createAtlasHook(ctx, {
          directory: ctx.directory,
          backgroundManager,
          isContinuationStopped: (sessionID: string) =>
            stopContinuationGuard?.isStopped(sessionID) ?? false,
        }))
    : null

  return {
    stopContinuationGuard,
    compactionContextInjector,
    compactionTodoPreserver,
    todoContinuationEnforcer,
    unstableAgentBabysitter,
    backgroundNotificationHook,
    atlasHook,
  }
}
