import type { OhMyOpenCodeConfig, HookName } from "../../config"
import type { PluginContext } from "../types"

import {
  createContextWindowMonitorHook,
  createSessionRecoveryHook,
  createSessionNotification,
  createThinkModeHook,
  createAnthropicContextWindowLimitRecoveryHook,
  createAutoUpdateCheckerHook,
  createAgentUsageReminderHook,
  createNonInteractiveEnvHook,
  createInteractiveBashSessionHook,
  createRalphLoopHook,
  createEditErrorRecoveryHook,
  createDelegateTaskRetryHook,
  createTaskResumeInfoHook,
  createStartWorkHook,
  createPrometheusMdOnlyHook,
  createSisyphusJuniorNotepadHook,
  createQuestionLabelTruncatorHook,
  createPreemptiveCompactionHook,
} from "../../hooks"
import { createAnthropicEffortHook } from "../../hooks/anthropic-effort"
import {
  detectExternalNotificationPlugin,
  getNotificationConflictWarning,
  log,
} from "../../shared"
import { safeCreateHook } from "../../shared/safe-create-hook"
import { sessionExists } from "../../tools"

export type SessionHooks = {
  contextWindowMonitor: ReturnType<typeof createContextWindowMonitorHook> | null
  preemptiveCompaction: ReturnType<typeof createPreemptiveCompactionHook> | null
  sessionRecovery: ReturnType<typeof createSessionRecoveryHook> | null
  sessionNotification: ReturnType<typeof createSessionNotification> | null
  thinkMode: ReturnType<typeof createThinkModeHook> | null
  anthropicContextWindowLimitRecovery: ReturnType<typeof createAnthropicContextWindowLimitRecoveryHook> | null
  autoUpdateChecker: ReturnType<typeof createAutoUpdateCheckerHook> | null
  agentUsageReminder: ReturnType<typeof createAgentUsageReminderHook> | null
  nonInteractiveEnv: ReturnType<typeof createNonInteractiveEnvHook> | null
  interactiveBashSession: ReturnType<typeof createInteractiveBashSessionHook> | null
  ralphLoop: ReturnType<typeof createRalphLoopHook> | null
  editErrorRecovery: ReturnType<typeof createEditErrorRecoveryHook> | null
  delegateTaskRetry: ReturnType<typeof createDelegateTaskRetryHook> | null
  startWork: ReturnType<typeof createStartWorkHook> | null
  prometheusMdOnly: ReturnType<typeof createPrometheusMdOnlyHook> | null
  sisyphusJuniorNotepad: ReturnType<typeof createSisyphusJuniorNotepadHook> | null
  questionLabelTruncator: ReturnType<typeof createQuestionLabelTruncatorHook>
  taskResumeInfo: ReturnType<typeof createTaskResumeInfoHook>
  anthropicEffort: ReturnType<typeof createAnthropicEffortHook> | null
}

export function createSessionHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}): SessionHooks {
  const { ctx, pluginConfig, isHookEnabled, safeHookEnabled } = args
  const safeHook = <T>(hookName: HookName, factory: () => T): T | null =>
    safeCreateHook(hookName, factory, { enabled: safeHookEnabled })

  const contextWindowMonitor = isHookEnabled("context-window-monitor")
    ? safeHook("context-window-monitor", () => createContextWindowMonitorHook(ctx))
    : null

  const preemptiveCompaction =
    isHookEnabled("preemptive-compaction") &&
    pluginConfig.experimental?.preemptive_compaction
      ? safeHook("preemptive-compaction", () => createPreemptiveCompactionHook(ctx))
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
          checkSessionExists: async (sessionId) => sessionExists(sessionId),
        }))
    : null

  const editErrorRecovery = isHookEnabled("edit-error-recovery")
    ? safeHook("edit-error-recovery", () => createEditErrorRecoveryHook(ctx))
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
    anthropicContextWindowLimitRecovery,
    autoUpdateChecker,
    agentUsageReminder,
    nonInteractiveEnv,
    interactiveBashSession,
    ralphLoop,
    editErrorRecovery,
    delegateTaskRetry,
    startWork,
    prometheusMdOnly,
    sisyphusJuniorNotepad,
    questionLabelTruncator,
    taskResumeInfo,
    anthropicEffort,
  }
}
