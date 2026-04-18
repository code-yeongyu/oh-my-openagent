import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import type { AutoUpdateCheckerOptions } from "./types"
import { getCachedVersion, getLocalDevVersion } from "./checker"
import { runBackgroundUpdateCheck } from "./hook/background-update-check"
import { scheduleDeferredIdleCheck } from "./hook/deferred-idle-check"
import { showConfigErrorsIfAny } from "./hook/config-errors-toast"
import { updateAndShowConnectedProvidersCacheStatus } from "./hook/connected-providers-status"
import { refreshModelCapabilitiesOnStartup } from "./hook/model-capabilities-status"
import { showModelCacheWarningIfNeeded } from "./hook/model-cache-warning"
import { showLocalDevToast, showVersionToast } from "./hook/startup-toasts"

interface AutoUpdateCheckerDeps {
  getCachedVersion: typeof getCachedVersion
  getLocalDevVersion: typeof getLocalDevVersion
  showConfigErrorsIfAny: typeof showConfigErrorsIfAny
  updateAndShowConnectedProvidersCacheStatus: typeof updateAndShowConnectedProvidersCacheStatus
  refreshModelCapabilitiesOnStartup: typeof refreshModelCapabilitiesOnStartup
  showModelCacheWarningIfNeeded: typeof showModelCacheWarningIfNeeded
  showLocalDevToast: typeof showLocalDevToast
  showVersionToast: typeof showVersionToast
  runBackgroundUpdateCheck: typeof runBackgroundUpdateCheck
  log: typeof log
}

const defaultDeps: AutoUpdateCheckerDeps = {
  getCachedVersion,
  getLocalDevVersion,
  showConfigErrorsIfAny,
  updateAndShowConnectedProvidersCacheStatus,
  refreshModelCapabilitiesOnStartup,
  showModelCacheWarningIfNeeded,
  showLocalDevToast,
  showVersionToast,
  runBackgroundUpdateCheck,
  log,
}

export function createAutoUpdateCheckerHook(
  ctx: PluginInput,
  options: AutoUpdateCheckerOptions = {},
  deps: AutoUpdateCheckerDeps = defaultDeps,
) {
  const {
    showStartupToast = true,
    isSisyphusEnabled = false,
    autoUpdate = true,
    modelCapabilities,
  } = options
  const isCliRunMode = process.env.OPENCODE_CLI_RUN_MODE === "true"

  const getToastMessage = (isUpdate: boolean, latestVersion?: string): string => {
    if (isSisyphusEnabled) {
      return isUpdate
        ? `Sisyphus on steroids is steering OpenCode.\nv${latestVersion} available. Restart to apply.`
        : "Sisyphus on steroids is steering OpenCode."
    }
    return isUpdate
      ? `OpenCode is now on Steroids. oMoMoMoMo...\nv${latestVersion} available. Restart OpenCode to apply.`
      : "OpenCode is now on Steroids. oMoMoMoMo..."
  }

  let hasChecked = false
  let hasScheduled = false

  return {
    event: ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.idle") return
      if (isCliRunMode) return
      if (hasChecked || hasScheduled) return

      hasScheduled = true

      scheduleDeferredIdleCheck(() => {
        hasChecked = true
        void (async () => {
          const cachedVersion = deps.getCachedVersion()
          const localDevVersion = deps.getLocalDevVersion(ctx.directory)
          const displayVersion = localDevVersion ?? cachedVersion

          await deps.showConfigErrorsIfAny(ctx)
          await deps.updateAndShowConnectedProvidersCacheStatus(ctx)
          await deps.refreshModelCapabilitiesOnStartup(modelCapabilities)
          await deps.showModelCacheWarningIfNeeded(ctx)

          if (localDevVersion) {
            if (showStartupToast) {
              deps.showLocalDevToast(ctx, displayVersion, isSisyphusEnabled).catch(() => {})
            }
            deps.log("[auto-update-checker] Local development mode")
            return
          }

          if (showStartupToast) {
            deps.showVersionToast(ctx, displayVersion, getToastMessage(false)).catch(() => {})
          }

          deps.runBackgroundUpdateCheck(ctx, autoUpdate, getToastMessage).catch((err) => {
            deps.log("[auto-update-checker] Background update check failed:", err)
          })
        })()
      })
    },
  }
}
