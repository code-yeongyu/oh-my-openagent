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
      // Marks the payload currently being self-emitted: a synchronous rejection
      // swaps `registration` for a refreshed one BEFORE our own REGISTER
      // listener sees the original payload, so identity against the current
      // registration alone would misread our own emission as a foreign one.
      let emittingRegistration: ConfigWatchRegistration | undefined
      const emitRegistration = (): void => {
        const payload = registration
        emittingRegistration = payload
        try {
          events.emit(CONFIG_WATCH_REGISTER, payload)
        } finally {
          emittingRegistration = undefined
        }
      }
      let retryTimer: ReturnType<typeof setTimeout> | undefined
      let rejectionFingerprint: string | undefined
      let rejectionRetries = 0
      const clearRetryTimer = (): void => {
        if (retryTimer !== undefined) clearTimeout(retryTimer)
        retryTimer = undefined
      }
      // Never emit REGISTER from inside a senpi event dispatch: rebuildWatchers
      // emits READY on the same synchronous stack as REGISTER, so a direct
      // re-emit recurses until RangeError whenever senpi's identity guard
      // cannot stop the echo (two live omo extension instances alternate
      // payload identities). One coalescing timer serves both the READY
      // re-registration and the rejection retry; the action is identical.
      // No unref(): a 0ms timer is self-draining (and dispose clears it),
      // while an unref'd one-shot timer can be starved indefinitely under Bun
      // on Windows — observed as a senpi-compatibility CI hang.
      const scheduleEmitRegistration = (): void => {
        clearRetryTimer()
        retryTimer = setTimeout(() => {
          retryTimer = undefined
          emitRegistration()
        }, 0)
      }
      const unsubscribes = [
        // senpi emits READY after every watcher rebuild, including the rebuild
        // caused by this component's own registration; re-register so the watch
        // survives a config-reload host restart that emptied its registrations.
        events.on(CONFIG_WATCH_READY, scheduleEmitRegistration),
        events.on(CONFIG_WATCH_REGISTER, (payload) => {
          if (payload === registration || payload === emittingRegistration) return
          if (!isRecord(payload) || payload.id !== OMO_REGISTRATION_ID) return
          // Another live omo extension instance registered the same id (e.g. a
          // dev plugin in senpi settings packages plus the omo launcher's
          // bundled --extension). senpi keeps only the LAST registration and
          // its re-registration guard compares payload identity, so two live
          // instances would rebuild-echo forever. The superseded instance
          // stands down; the last registrant keeps the watch.
          ctx.logger.warn("omo config-watch superseded by another omo extension instance; standing down", {
            hint: "two omo extensions are loaded in this senpi process (e.g. a local dev plugin in senpi settings packages plus the omo launcher's bundled extension); remove one",
          })
          dispose()
          if (releasePrevious === dispose) releasePrevious = undefined
        }),
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
          scheduleEmitRegistration()
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
