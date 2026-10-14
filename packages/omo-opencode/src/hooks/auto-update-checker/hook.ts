import type { PluginInput } from "@opencode-ai/plugin"
import { isRecord } from "@oh-my-opencode/utils"
import { log } from "../../shared/logger"
import type { AutoUpdateCheckerOptions } from "./types"
import { getBundledVersion, getCachedVersion, getLocalDevVersion } from "./checker"
import { runBackgroundUpdateCheck } from "./hook/background-update-check"
import { trackLoadedPluginSandbox } from "./checker/sandbox-refresh"
import { scheduleDeferredStartupCheck } from "./hook/deferred-startup-check"
import { showConfigErrorsIfAny } from "./hook/config-errors-toast"
import { updateAndShowConnectedProvidersCacheStatus } from "./hook/connected-providers-status"
import { refreshModelCapabilitiesOnStartup } from "./hook/model-capabilities-status"
import { showModelCacheWarningIfNeeded } from "./hook/model-cache-warning"
import { showLocalDevToast, showVersionToast } from "./hook/startup-toasts"
import { ignoreToastError } from "./hook/ignore-toast-error"
import { getStartupCheckProcessState } from "./startup-check-process-state"

interface AutoUpdateCheckerDeps {
  getBundledVersion?: typeof getBundledVersion
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
  /** Registers the exit-time sandbox refresh for this process (see checker/sandbox-refresh.ts). */
  trackLoadedPluginSandbox?: () => void
}

const defaultDeps: AutoUpdateCheckerDeps = {
  getBundledVersion,
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
  trackLoadedPluginSandbox: () => trackLoadedPluginSandbox(),
}

const getParentID = (properties: unknown): string | undefined => {
  if (!isRecord(properties)) return undefined

  const { info } = properties
  if (!isRecord(info)) return undefined

  const { parentID } = info
  return typeof parentID === "string" && parentID.length > 0 ? parentID : undefined
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
  deps.trackLoadedPluginSandbox?.()

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
      if (event.type !== "session.created") return
      if (isCliRunMode) return
      if (hasChecked || hasScheduled) return
      if (getParentID(event.properties)) return

      const processState = getStartupCheckProcessState()
      if (processState.completed || processState.running) {
        deps.log(
          "[auto-update-checker] startup check already completed in this process; skipping per-instance rerun",
        )
        hasChecked = true
        return
      }

      hasScheduled = true
      processState.running = true

      scheduleDeferredStartupCheck(() => {
        hasChecked = true
        void (async () => {
          const bundledVersion = deps.getBundledVersion?.()
          const localDevVersion = deps.getLocalDevVersion(ctx.directory)
          // Banner reflects the bundled (build-time) version so it never drifts
          // from `--version`, even if a stale cache copy lingers in OpenCode's
          // plugin sandbox. Background update-check still uses `getCachedVersion()`
          // because that's the artifact we're comparing against npm's `latest`.
          // getBundledVersion is optional so injected-deps callers built before
          // it existed keep the legacy cached-version banner instead of crashing.
          const displayVersion = localDevVersion ?? bundledVersion ?? deps.getCachedVersion()

          await deps.showConfigErrorsIfAny(ctx)
          await deps.updateAndShowConnectedProvidersCacheStatus(ctx)
          await deps.refreshModelCapabilitiesOnStartup(modelCapabilities)
          await deps.showModelCacheWarningIfNeeded(ctx)

          if (localDevVersion) {
            if (showStartupToast) {
              deps.showLocalDevToast(ctx, displayVersion, isSisyphusEnabled).catch(ignoreToastError)
            }
            deps.log("[auto-update-checker] Local development mode")
            return
          }

          if (showStartupToast) {
            deps.showVersionToast(ctx, displayVersion, getToastMessage(false)).catch(ignoreToastError)
          }

          deps.runBackgroundUpdateCheck(ctx, autoUpdate, getToastMessage).catch((err) => {
            deps.log("[auto-update-checker] Background update check failed:", err)
          })
        })()
          .catch((error) => {
            // A failed startup check must neither crash the process nor fan
            // out retries on the next plugin instance.
            deps.log("[auto-update-checker] startup check failed:", error)
          })
          .finally(() => {
            processState.running = false
            processState.completed = true
          })
      })
    },
  }
}
