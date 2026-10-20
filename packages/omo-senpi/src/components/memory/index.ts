import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import { resolveMemoryRoot } from "@oh-my-opencode/memory-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig, type SenpiOmoConfigResult } from "../config-resolution"
import { MEMORY_BINDING_CUSTOM_TYPE } from "./binding"
import { renderMemoryBindingEntry } from "./bindings/entry-renderer"
import { hasMemoryCapabilities, missingMemoryCapabilities } from "./capabilities"
import { primeMemoryPersonaAssets } from "./persona-prime"
import { shutdownDeadlineAt, type ShutdownReason } from "./shutdown-drain"
import { resolveMemorySettings } from "./identity-runtime"
import { registerMemoryReadClassifier } from "./read-classifier-wiring"
import { createSessionBinder, readSessionSurface, releaseSession, type SessionState } from "./session-binding"
import { finalizeIdentityRun } from "./transient-identity"
import { createSyncRunner, type SyncRunner } from "./sync-runner"
import { sweepTransientMemoryRuns, type TransientSweep } from "./transient-sweep"
import { createMemoryWiring, type MemoryWiringOptions } from "./wiring"

const GLOBAL_DISABLED_FLAG = "omo-senpi-disabled"
const MEMORY_DISABLED_FLAG = "omo-senpi-memory-disabled"
const CONFIG_WATCH_RELOADED = "config-watch:reloaded"
const RESTART_REQUIRED_NOTICE = "restart required to apply memory config change"

export type ResolvedMemoryConfig = OmoMemorySettings

export interface MemoryComponentOptions {
  readonly env?: Record<string, string | undefined>
  readonly loadConfig?: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly now?: () => number
  readonly resolveCwd?: () => string
  readonly createRuntime?: MemoryWiringOptions["createRuntime"]
  readonly refreshStatus?: MemoryWiringOptions["refreshStatus"]
  /** Seam for the registration-time transient sweep (transient-sweep.ts). */
  readonly sweepTransientRuns?: TransientSweep
  /** Seam for the end-to-end encrypted sync runner (sync-runner.ts). */
  readonly syncRunner?: SyncRunner
}

export { MEMORY_BINDING_CUSTOM_TYPE } from "./binding"
export { ensureIdentityRuntimeDirs, getMemoryRepo } from "./context"
export type { MemoryIdentityContext, MemoryPendingLedger, MemoryRepoAccess } from "./context"
export { memoryModuleSupervisor } from "./supervisor"

export function createMemoryComponent(options: MemoryComponentOptions = {}): OmoSenpiComponent {
  const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
  const now = options.now ?? Date.now
  const env = options.env ?? process.env
  const sweepTransientRuns = options.sweepTransientRuns ?? sweepTransientMemoryRuns
  const sessions = new Map<string, SessionState>()

  return {
    name: "memory",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const resolveCwd = options.resolveCwd ?? (() => extensionCwd(pi))
      const cwd = resolveCwd()
      const bootConfig = resolveMemoryConfig(loadConfig({ cwd }))
      if (!isEnabled(bootConfig, ctx, env)) return

      const missing = missingMemoryCapabilities(pi)
      if (missing.length > 0 || !hasMemoryCapabilities(pi)) {
        ctx.logger.warn("omo-senpi memory component skipped: missing ExtensionAPI capabilities", { missing })
        return
      }

      const syncRunner = options.syncRunner ?? createSyncRunner({ logger: ctx.logger })
      primeMemoryPersonaAssets({ logger: ctx.logger })
      // Reclaim runs an abnormal exit left behind (#7765). Detached from registration on purpose:
      // it is pure maintenance, and a slow or failing sweep must never delay or break binding.
      void sweepTransientRuns({
        memoryRoot: resolveMemoryRoot(env, cwd),
        warn: (message, fields) => ctx.logger.warn(message, fields),
      }).catch((error: unknown) => {
        ctx.logger.warn("omo-senpi memory transient sweep failed", { error: describeError(error) })
      })

      const wiring = createMemoryWiring({
        sessions,
        loadConfig,
        cwd: resolveCwd,
        env,
        now,
        logger: ctx.logger,
        deviceName: (principal) => syncRunner.deviceName(principal),
        ...(options.createRuntime === undefined ? {} : { createRuntime: options.createRuntime }),
        ...(options.refreshStatus === undefined ? {} : { refreshStatus: options.refreshStatus }),
        // Reuse the boot snapshot: registration must not add a loadConfig() call, because the
        // enablement latch depends on the ORDER of reads across boot -> session_start -> reload.
      })
      const bindSession = createSessionBinder({
        pi,
        ctx,
        env,
        now,
        cwd,
        loadConfig,
        sessions,
        wiring,
        syncRunner,
        isEnabled: (config) => isEnabled(config, ctx, env),
        resolveConfig: resolveMemoryConfig,
      })
      wiring.registerStatic(pi, ctx)
      // A session that reaches a turn without session_start in this runner generation (a host
      // restart or reload that resumed an open conversation) is bound here from its own recorded
      // binding. Registered after the static handlers so their projection-first result order holds:
      // the memory tool is live on this turn (afterBind marks the session active) and the prompt
      // block follows on the next one.
      pi.on("before_agent_start", (payload, eventCtx) => {
        if (isRecord(payload) && payload.preview === true) return undefined
        const surface = readSessionSurface(eventCtx)
        if (surface.id === "unknown-session") return undefined
        const state = sessions.get(surface.id)
        if (state?.context !== undefined) return undefined
        if (state !== undefined && !state.enabled) return undefined
        bindSession(surface, eventCtx, { existing: state, verifyRepository: true })
        return undefined
      }, { previewSafe: true })
      const unregisterReadClassifier = registerMemoryReadClassifier(pi, {
        resolveRepos: function* () {
          for (const state of sessions.values()) {
            if (state.context !== undefined) yield state.context.identityPaths.repo
          }
        },
        logger: ctx.logger,
      })
      pi.registerEntryRenderer(MEMORY_BINDING_CUSTOM_TYPE, renderMemoryBindingEntry)
      const unsubscribeReload = pi.events?.on(CONFIG_WATCH_RELOADED, (payload) => {
        if (!isOmoConfigReload(payload)) return
        const enabled = isEnabled(resolveMemoryConfig(loadConfig({ cwd })), ctx, env)
        for (const state of sessions.values()) {
          if (state.enabled === enabled || state.restartNotified) continue
          state.restartNotified = true
          state.ui?.notify(RESTART_REQUIRED_NOTICE, "warning")
        }
      })

      pi.on("session_start", (_payload, eventCtx) => {
        const surface = readSessionSurface(eventCtx)
        wiring.clearStatus(eventCtx)
        releaseSession(sessions.get(surface.id), syncRunner)
        bindSession(surface, eventCtx, { existing: undefined, verifyRepository: false })
      })

      pi.on("session_shutdown", async (payload, eventCtx) => {
        const sessionId = readSessionSurface(eventCtx).id
        // The drain runs BEFORE the session is released: its steps read the bound identity.
        await wiring.onSessionShutdown({
          reason: readShutdownReason(payload),
          sessionId,
          deadlineAt: shutdownDeadlineAt(now),
          now,
        })
        wiring.clearStatus(eventCtx)
        const state = sessions.get(sessionId)
        const syncRelease = state?.syncRepo === undefined ? undefined : syncRunner.release(state.syncRepo)
        releaseSession(state)
        sessions.delete(sessionId)
        await syncRelease
        if (state?.run !== undefined) {
          await finalizeIdentityRun({ run: state.run, warn: (message, fields) => ctx.logger.warn(message, fields) })
        }
        if (sessions.size === 0) unregisterReadClassifier?.()
        unsubscribeReload?.()
      })
    },
  }
}

export function resolveMemoryConfig(loaded: SenpiOmoConfigResult): ResolvedMemoryConfig {
  return resolveMemorySettings(loaded.config.memory)
}

// Detached memory workers carry sentinels so their own settles do not recursively trigger memory.
const CHILD_SENTINELS = ["SENPI_MEMORY_REFLECTION", "SENPI_MEMORY_FACTS"] as const

export function isMemoryChildProcess(env: Record<string, string | undefined>): boolean {
  return CHILD_SENTINELS.some((sentinel) => env[sentinel] === "1")
}

function isEnabled(
  config: ResolvedMemoryConfig,
  ctx: ComponentContext,
  env: Record<string, string | undefined>,
): boolean {
  return config.enabled
    && !isMemoryChildProcess(env)
    && ctx.config.getFlag(GLOBAL_DISABLED_FLAG) !== true
    && ctx.config.getFlag(MEMORY_DISABLED_FLAG) !== true
}

function extensionCwd(pi: SenpiExtensionAPI): string {
  return typeof pi.cwd === "string" && pi.cwd.length > 0 ? pi.cwd : process.cwd()
}

const SHUTDOWN_REASONS: readonly ShutdownReason[] = ["quit", "reload", "new", "resume", "fork"]

/** An unknown or absent reason drains conservatively: flush and enqueue, launch nothing. */
function readShutdownReason(payload: unknown): ShutdownReason {
  if (!isRecord(payload)) return "reload"
  const reason = payload.reason
  return SHUTDOWN_REASONS.find((candidate) => candidate === reason) ?? "reload"
}

function isOmoConfigReload(value: unknown): boolean {
  return isRecord(value) && value.registrationId === "omo"
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
