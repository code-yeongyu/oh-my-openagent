import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import {
  resolveOmoConfigWatchTargetResolution,
  type OmoConfigWatchTarget,
  type OmoConfigWatchTargetResolution,
} from "./paths"
import { createOmoConfigValidator, type OmoConfigValidator } from "./validate"

const CONFIG_WATCH_REGISTER = "config-watch:register"
const CONFIG_WATCH_READY = "config-watch:ready"
const CONFIG_WATCH_RELOADED = "config-watch:reloaded"
const CONFIG_WATCH_REJECTED = "config-watch:rejected"
const SESSION_SHUTDOWN = "session_shutdown"
const OMO_REGISTRATION_ID = "omo"
// Bounded retry budget per distinct rejected payload. senpi rejects on the
// same synchronous stack that delivered REGISTER, so an unbounded re-emit
// recurses until RangeError whenever the rejection is deterministic.
const MAX_REJECTION_RETRIES = 3

type ConfigWatchRegistration = {
  readonly id: "omo"
  readonly displayName: ".omo config"
  readonly targets: OmoConfigWatchTarget[]
  readonly validate: OmoConfigValidator["validate"]
}

type ConfigWatchReloaded = {
  readonly registrationId: string
  readonly paths: string[]
}

type ConfigWatchRejected = ConfigWatchReloaded & {
  readonly errors: string[]
}

export interface ConfigWatchComponentOptions {
  readonly resolveCwd?: () => string
  readonly resolveTargets?: (options: { readonly cwd: string }) => readonly OmoConfigWatchTarget[]
  readonly resolveTargetResolution?: (options: { readonly cwd: string }) => OmoConfigWatchTargetResolution
  readonly createValidator?: (options: { readonly cwd: string }) => OmoConfigValidator
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string")
}

function isReloaded(value: unknown): value is ConfigWatchReloaded {
  return isRecord(value) && typeof value.registrationId === "string" && isStringArray(value.paths)
}

function isRejected(value: unknown): value is ConfigWatchRejected {
  return (
    isRecord(value) &&
    typeof value.registrationId === "string" &&
    isStringArray(value.paths) &&
    isStringArray(value.errors)
  )
}

function release(unsubscribes: readonly (() => void)[]): void {
  for (const unsubscribe of unsubscribes) unsubscribe()
}

/** Registers omo config surfaces with senpi's optional in-process config-watch protocol. */
export function createConfigWatchComponent(options: ConfigWatchComponentOptions = {}): OmoSenpiComponent {
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const resolveTargetResolution = options.resolveTargetResolution
    ?? ((request: { readonly cwd: string }): OmoConfigWatchTargetResolution => {
      if (options.resolveTargets === undefined) return resolveOmoConfigWatchTargetResolution(request)
      return {
        targets: options.resolveTargets(request),
        userConfigCreationWatched: true,
        userConfigCreationDiscovery: "watched",
      }
    })
  const createValidator = options.createValidator ?? createOmoConfigValidator
  let releasePrevious: (() => void) | undefined

  return {
    name: "config-watch",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      releasePrevious?.()
      releasePrevious = undefined

      const events = pi.events
      if (events === undefined) {
        ctx.logger.warn("config-watch skipped: events capability missing")
        return
      }

      const cwd = resolveCwd()
      const validator = createValidator({ cwd })
      let userConfigReloadWarningLogged = false
      const createRegistration = (): ConfigWatchRegistration => {
        const resolution = resolveTargetResolution({ cwd })
        if (resolution.userConfigCreationDiscovery === "reload_required" && !userConfigReloadWarningLogged) {
          userConfigReloadWarningLogged = true
          ctx.logger.warn("config-watch user config discovery requires reload", {
            userConfigCreationDiscovery: resolution.userConfigCreationDiscovery,
          })
        }
        return {
          id: OMO_REGISTRATION_ID,
          displayName: ".omo config",
          targets: resolution.targets.map((target) => ({
            path: target.path,
            kind: target.kind,
            filterGlobs: [...target.filterGlobs],
          })),
          // Preserve one validator across target refreshes so a rejected
          // diagnostic remains sticky until its source is actually repaired.
          validate: validator.validate,
        }
      }
      let registration = createRegistration()
      const emitRegistration = (): void => events.emit(CONFIG_WATCH_REGISTER, registration)
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      let rejectionFingerprint: string | undefined
      let rejectionRetries = 0
      const clearRetryTimer = (): void => {
        if (retryTimer !== undefined) clearTimeout(retryTimer)
        retryTimer = undefined
      }
      const unsubscribes = [
        events.on(CONFIG_WATCH_READY, emitRegistration),
        events.on(CONFIG_WATCH_RELOADED, (payload) => {
          if (!isReloaded(payload) || payload.registrationId !== OMO_REGISTRATION_ID) return
          ctx.logger.info("omo config hot-reloaded", { paths: payload.paths, pathCount: payload.paths.length })
        }),
        events.on(CONFIG_WATCH_REJECTED, (payload) => {
          if (!isRejected(payload) || payload.registrationId !== OMO_REGISTRATION_ID) return
          ctx.logger.warn("omo config hot-reload rejected", {
            paths: payload.paths,
            pathCount: payload.paths.length,
            errors: payload.errors,
            errorCount: payload.errors.length,
          })
          // A new ancestor .omo directory is initially covered only by its
          // parent creation watch. Refresh targets after rejection so its file
          // watcher sees the repair without resetting sticky validation state.
          // Never re-register synchronously: senpi emits REJECTED on the same
          // synchronous stack as REGISTER, so a direct re-emit recurses until
          // stack overflow when the rejection is deterministic (e.g. a target
          // covering the senpi agent dir). Defer the retry to a fresh task and
          // cap it per payload fingerprint; a changed payload (the repair
          // landing) resets the budget.
          registration = createRegistration()
          const fingerprint = JSON.stringify(registration.targets)
          if (fingerprint !== rejectionFingerprint) {
            rejectionFingerprint = fingerprint
            rejectionRetries = 0
          }
          if (rejectionRetries >= MAX_REJECTION_RETRIES) {
            ctx.logger.warn("omo config hot-reload retry budget exhausted", {
              fingerprintTargetCount: registration.targets.length,
              maxRejectionRetries: MAX_REJECTION_RETRIES,
            })
            return
          }
          rejectionRetries += 1
          clearRetryTimer()
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            emitRegistration()
          }, 0)
          retryTimer.unref()
        }),
      ]
      const dispose = (): void => {
        clearRetryTimer()
        release(unsubscribes)
      }
      releasePrevious = dispose
      pi.on(SESSION_SHUTDOWN, () => {
        dispose()
        if (releasePrevious === dispose) releasePrevious = undefined
      })
      emitRegistration()
    },
  }
}
