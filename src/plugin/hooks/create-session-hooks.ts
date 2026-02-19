import type { OhMyOpenCodeConfig, HookName } from "../../config"
import type { ModelCacheState } from "../../plugin-state"
import type { PluginContext } from "../types"

import {
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createSessionNotification,
  createThinkModeHook,
  createModelFallbackHook,
  createAnthropicContextWindowLimitRecoveryHook,
  createAutoUpdateCheckerHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,
  createRalphLoopHook,
  createEditErrorRecoveryHook,
  createJsonErrorRecoveryHook,
  createDelegateTaskRetryHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createPrometheusMdOnlyHook,
  createSisyphusJuniorNotepadHook,
  createNoSisyphusGptHook,
  createNoHephaestusNonGptHook,
  createQuestionLabelTruncatorHook,
  createPreemptiveCompactionHook,
} from "../../hooks"
import { createAnthropicEffortHook } from "../../hooks/anthropic-effort"
import {
  detectExternalNotificationPlugin,
  getNotificationConflictWarning,
  log,
  normalizeSDKResponse,
} from "../../shared"
import { safeCreateHook } from "../../shared/safe-create-hook"
import { sessionExists } from "../../tools"

export type SessionHooks = {
  contextWindowMonitor: ReturnType<typeof createContextWindowMonitorHook> | null
  preemptiveCompaction: ReturnType<typeof createPreemptiveCompactionHook> | null
  sessionRecovery: ReturnType<typeof createSessionRecoveryHook> | null
  sessionNotification: ReturnType<typeof createSessionNotification> | null
  thinkMode: ReturnType<typeof createThinkModeHook> | null
  modelFallback: ReturnType<typeof createModelFallbackHook> | null
  anthropicContextWindowLimitRecovery: ReturnType<typeof createAnthropicContextWindowLimitRecoveryHook> | null
  autoUpdateChecker: ReturnType<typeof createAutoUpdateCheckerHook> | null
  agentUsageReminder: ReturnType<typeof createAgentUsageReminderHook> | null
  nonInteractiveEnv: ReturnType<typeof createNonInteractiveEnvHook> | null
  interactiveBashSession: ReturnType<typeof createInteractiveBashSessionHook> | null
  ralphLoop: ReturnType<typeof createRalphLoopHook> | null
  editErrorRecovery: ReturnType<typeof createEditErrorRecoveryHook> | null
  jsonErrorRecovery: ReturnType<typeof createJsonErrorRecoveryHook> | null
  delegateTaskRetry: ReturnType<typeof createDelegateTaskRetryHook> | null
  startWork: ReturnType<typeof createStartWorkHook> | null
  prometheusMdOnly: ReturnType<typeof createPrometheusMdOnlyHook> | null
  sisyphusJuniorNotepad: ReturnType<typeof createSisyphusJuniorNotepadHook> | null
  noSisyphusGpt: ReturnType<typeof createNoSisyphusGptHook> | null
  noHephaestusNonGpt: ReturnType<typeof createNoHephaestusNonGptHook> | null
  questionLabelTruncator: ReturnType<typeof createQuestionLabelTruncatorHook>
  taskResumeInfo: ReturnType<typeof createTaskResumeInfoHook>
  anthropicEffort: ReturnType<typeof createAnthropicEffortHook> | null
}

export function createSessionHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}): SessionHooks {
  const { ctx, pluginConfig, modelCacheState, isHookEnabled, safeHookEnabled } = args
  const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
    safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? safeHook("context-window-monitor", () =>
        createContextWindowMonitorHook(ctx, modelCacheState))
    : null

  const preemptiveCompaction =
    isHookEnabled("preemptive-compaction") &&
    pluginConfig.experimental?.preemptive_compaction
      ? safeHook("preemptive-compaction", () =>
          createPreemptiveCompactionHook(ctx, modelCacheState))
      : null

  const sessionRecovery = isHookEnabled("session-recovery")
    ? safeHook("session-recovery", () =>
        createSessionRecoveryHook(ctx, { experimental: pluginConfig.experimental }))
    : null

  let sessionNotification: ReturnType<typeof createSessionNotification> | null = null
  if (isHookEnabled("session-notification")) {
    const forceEnable = pluginConfig.notification?.force_enable ?? false
    const externalNotifier = detectExternalNotificationPlugin(ctx.directory)
    if (externalNotifier.detected && !forceEnable) {
      log(getNotificationConflictWarning(externalNotifier.pluginName!))
    } else {
      sessionNotification = safeHook("session-notification", () => createSessionNotification(ctx))
    }
  }

  const thinkMode = isHookEnabled("think-mode")
    ? safeHook("think-mode", () => createThinkModeHook())
    : null

  const enableFallbackTitle = pluginConfig.experimental?.model_fallback_title ?? false
  const fallbackTitleMaxEntries = 200
  const fallbackTitleState = new Map<string, { baseTitle?: string; lastKey?: string }>()
  const updateFallbackTitle = async (input: {
    sessionID: string
    providerID: string
    modelID: string
    variant?: string
  }) => {
    if (!enableFallbackTitle) return
    const key = `${input.providerID}/${input.modelID}${input.variant ? `:${input.variant}` : ""}`
    const existing = fallbackTitleState.get(input.sessionID) ?? {}
    if (existing.lastKey === key) return

    if (!existing.baseTitle) {
      const sessionResp = await ctx.client.session.get({ path: { id: input.sessionID } }).catch(() => null)
      const sessionInfo = sessionResp
        ? normalizeSDKResponse(sessionResp, null as { title?: string } | null, { preferResponseOnMissingData: true })
        : null
      const rawTitle = sessionInfo?.title
      if (typeof rawTitle === "string" && rawTitle.length > 0) {
        existing.baseTitle = rawTitle.replace(/\s*\[fallback:[^\]]+\]$/i, "").trim()
      } else {
        existing.baseTitle = "Session"
      }
    }

    const variantLabel = input.variant ? ` ${input.variant}` : ""
    const newTitle = `${existing.baseTitle} [fallback: ${input.providerID}/${input.modelID}${variantLabel}]`

    await ctx.client.session
      .update({
        path: { id: input.sessionID },
        body: { title: newTitle },
        query: { directory: ctx.directory },
      })
      .catch(() => {})

    existing.lastKey = key
    fallbackTitleState.set(input.sessionID, existing)
    if (fallbackTitleState.size > fallbackTitleMaxEntries) {
      const oldestKey = fallbackTitleState.keys().next().value
      if (oldestKey) fallbackTitleState.delete(oldestKey)
    }
  }

  // Model fallback hook (configurable via disabled_hooks)
  // This handles automatic model switching when model errors occur
  const modelFallback = isHookEnabled("model-fallback")
    ? safeHook("model-fallback", () =>
      createModelFallbackHook({
        toast: async ({ title, message, variant, duration }) => {
          await ctx.client.tui
            .showToast({
              body: {
                title,
                message,
                variant: variant ?? "warning",
                duration: duration ?? 5000,
              },
            })
            .catch(() => {})
        },
        onApplied: enableFallbackTitle ? updateFallbackTitle : undefined,
      }))
    : null

  const anthropicContextWindowLimitRecovery = isHookEnabled("anthropic-context-window-limit-recovery")
    ? safeHook("anthropic-context-window-limit-recovery", () =>
        createAnthropicContextWindowLimitRecoveryHook(ctx, { experimental: pluginConfig.experimental }))
    : null

  const autoUpdateChecker = isHookEnabled("auto-update-checker")
    ? safeHook("auto-update-checker", () =>
        createAutoUpdateCheckerHook(ctx, {
          showStartupToast: isHookEnabled("startup-toast"),
          isSisyphusEnabled: pluginConfig.sisyphus_agent?.disabled !== true,
          autoUpdate: pluginConfig.auto_update ?? true,
        }))
    : null

  const agentUsageReminder = isHookEnabled("agent-usage-reminder")
    ? safeHook("agent-usage-reminder", () => createAgentUsageReminderHook(ctx))
    : null

  const nonInteractiveEnv = isHookEnabled("non-interactive-env")
    ? safeHook("non-interactive-env", () => createNonInteractiveEnvHook(ctx))
    : null

  const interactiveBashSession = isHookEnabled("interactive-bash-session")
    ? safeHook("interactive-bash-session", () => createInteractiveBashSessionHook(ctx))
    : null

  const ralphLoop = isHookEnabled("ralph-loop")
    ? safeHook("ralph-loop", () =>
        createRalphLoopHook(ctx, {
          config: pluginConfig.ralph_loop,
          checkSessionExists: async (sessionId) => await sessionExists(sessionId),
        }))
    : null

  const editErrorRecovery = isHookEnabled("edit-error-recovery")
    ? safeHook("edit-error-recovery", () => createEditErrorRecoveryHook(ctx))
    : null

  const jsonErrorRecovery = isHookEnabled("json-error-recovery")
    ? safeHook("json-error-recovery", () => createJsonErrorRecoveryHook(ctx))
    : null

  const delegateTaskRetry = isHookEnabled("delegate-task-retry")
    ? safeHook("delegate-task-retry", () => createDelegateTaskRetryHook(ctx))
    : null

  const startWork = isHookEnabled("start-work")
    ? safeHook("start-work", () => createStartWorkHook(ctx))
    : null

  const prometheusMdOnly = isHookEnabled("prometheus-md-only")
    ? safeHook("prometheus-md-only", () => createPrometheusMdOnlyHook(ctx))
    : null

  const sisyphusJuniorNotepad = isHookEnabled("sisyphus-junior-notepad")
    ? safeHook("sisyphus-junior-notepad", () => createSisyphusJuniorNotepadHook(ctx))
    : null

  const noSisyphusGpt = isHookEnabled("no-sisyphus-gpt")
    ? safeHook("no-sisyphus-gpt", () => createNoSisyphusGptHook(ctx))
    : null

  const noHephaestusNonGpt = isHookEnabled("no-hephaestus-non-gpt")
    ? safeHook("no-hephaestus-non-gpt", () => createNoHephaestusNonGptHook(ctx))
    : null

  const questionLabelTruncator = createQuestionLabelTruncatorHook()
  const taskResumeInfo = createTaskResumeInfoHook()

  const anthropicEffort = isHookEnabled("anthropic-effort")
    ? safeHook("anthropic-effort", () => createAnthropicEffortHook())
    : null

  return {
    contextWindowMonitor,
    preemptiveCompaction,
    sessionRecovery,
    sessionNotification,
    thinkMode,
    modelFallback,
    anthropicContextWindowLimitRecovery,
    autoUpdateChecker,
    agentUsageReminder,
    nonInteractiveEnv,
    interactiveBashSession,
    ralphLoop,
    editErrorRecovery,
    jsonErrorRecovery,
    delegateTaskRetry,
    startWork,
    prometheusMdOnly,
    sisyphusJuniorNotepad,
    noSisyphusGpt,
    noHephaestusNonGpt,
    questionLabelTruncator,
    taskResumeInfo,
    anthropicEffort,
  }
}
