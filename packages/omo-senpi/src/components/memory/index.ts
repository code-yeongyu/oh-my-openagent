import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import { resolveMemoryIdentity, resolveMemoryRoot } from "@oh-my-opencode/memory-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig, type SenpiOmoConfigResult } from "../config-resolution"
import {
  MEMORY_BINDING_CUSTOM_TYPE,
  createMemoryBinding,
  findLatestMemoryBinding,
  type SessionEntryLike,
} from "./binding"
import { logBindReconcileFailure } from "./bind-reconcile-log"
import { renderMemoryBindingEntry } from "./bindings/entry-renderer"
import { hasMemoryCapabilities, missingMemoryCapabilities } from "./capabilities"
import { primeMemoryPersonaAssets } from "./persona-prime"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { shutdownDeadlineAt, type ShutdownReason } from "./shutdown-drain"
import { resolveMemorySettings } from "./identity-runtime"
import { memoryModuleSupervisor } from "./supervisor"
import { registerMemoryReadClassifier } from "./read-classifier-wiring"
import {
  finalizeIdentityRun,
  isOneShotSurface,
  resolveIdentityRunPaths,
  type IdentityRunPaths,
} from "./transient-identity"
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
}

type SessionUi = { notify(message: string, level: "error" | "warning"): void }
type SessionSurface = {
  readonly entries: readonly SessionEntryLike[]
  readonly id: string
  readonly ui?: SessionUi
  readonly hasUI?: boolean
}
type SessionState = {
  readonly enabled: boolean
  readonly ui?: SessionUi
  context?: MemoryIdentityContext
  /** Where this session's identity storage lives; finalized (transient root reclaimed) at shutdown. */
  run?: IdentityRunPaths
  memoryStatusAttempted: boolean
  restartNotified: boolean
  conflictNotified: boolean
}

export { MEMORY_BINDING_CUSTOM_TYPE } from "./binding"
export { ensureIdentityRuntimeDirs, getMemoryRepo } from "./context"
export type { MemoryIdentityContext, MemoryPendingLedger, MemoryRepoAccess } from "./context"
export { memoryModuleSupervisor } from "./supervisor"

export function createMemoryComponent(options: MemoryComponentOptions = {}): OmoSenpiComponent {
  const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const now = options.now ?? Date.now
  const env = options.env ?? process.env
  const sweepTransientRuns = options.sweepTransientRuns ?? sweepTransientMemoryRuns
  const sessions = new Map<string, SessionState>()

  return {
    name: "memory",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const cwd = resolveCwd()
      const bootConfig = resolveMemoryConfig(loadConfig({ cwd }))
      if (!isEnabled(bootConfig, ctx, env)) return

      const missing = missingMemoryCapabilities(pi)
      if (missing.length > 0 || !hasMemoryCapabilities(pi)) {
        ctx.logger.warn("omo-senpi memory component skipped: missing ExtensionAPI capabilities", { missing })
        return
      }

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
        ...(options.createRuntime === undefined ? {} : { createRuntime: options.createRuntime }),
        ...(options.refreshStatus === undefined ? {} : { refreshStatus: options.refreshStatus }),
        // Reuse the boot snapshot: registration must not add a loadConfig() call, because the
        // enablement latch depends on the ORDER of reads across boot -> session_start -> reload.
      })
      const bindSession = (
        surface: SessionSurface,
        eventCtx: unknown,
        options: { readonly existing: SessionState | undefined; readonly verifyRepository: boolean },
      ): void => {
        const sessionConfig = resolveMemoryConfig(loadConfig({ cwd }))
        const state: SessionState = options.existing ?? {
          enabled: isEnabled(sessionConfig, ctx, env),
          memoryStatusAttempted: false,
          restartNotified: false,
          conflictNotified: false,
          ...(surface.ui === undefined ? {} : { ui: surface.ui }),
        }
        sessions.set(surface.id, state)
        if (!state.enabled) return

        const identity = resolveMemoryIdentity(sessionConfig.agent, cwd, env)
        const previous = findLatestMemoryBinding(surface.entries)
        const binding = createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: now() })
        // A rebind has no session_start behind it, so the recorded entry is the only evidence of what
        // this session was: it must agree on the memory repository too, not only on the identity.
        const conflict = previous !== undefined
          && (previous.identity !== identity.id || (options.verifyRepository && previous.repoPathHash !== binding.repoPathHash))
        if (conflict) {
          if (!state.conflictNotified) {
            state.conflictNotified = true
            surface.ui?.notify(
              `memory identity conflict: session is bound to ${previous.identity}, but config resolved ${identity.id}; restart with the original identity or fork a new session`,
              "error",
            )
            ctx.logger.warn("omo-senpi memory binding failed closed", {
              sessionId: surface.id,
              bound: previous.identity,
              resolved: identity.id,
            })
          }
          return
        }

        const run = resolveIdentityRunPaths({
          identity: identity.id,
          identityPaths: identity.paths,
          memoryRoot: resolveMemoryRoot(env, cwd),
          oneShot: isOneShotSurface({ hasUI: surface.hasUI, env }),
        })
        state.run = run
        state.context = createMemoryIdentityContext({
          identity: identity.id,
          identityPaths: run.paths,
          durableRoot: run.durableRoot,
          binding,
        })
        memoryModuleSupervisor.acquire()
        pi.appendEntry(MEMORY_BINDING_CUSTOM_TYPE, binding)
        // Bind-time reconcile floats past the bind by design, but its rejection must not
        // float: an unhandled rejection is attributed to whatever code is running when it lands.
        void wiring.afterBind(pi, surface.id, state.context, eventCtx).catch((error: unknown) => {
          logBindReconcileFailure(ctx.logger, error)
        })
      }

      wiring.registerStatic(pi, ctx)
      // A session that reaches a turn without session_start in this runner generation (a host
      // restart or reload that resumed an open conversation) is bound here from its own recorded
      // binding. Registered after the static handlers so their projection-first result order holds:
      // the memory tool is live on this turn (afterBind marks the session active) and the prompt
      // block follows on the next one.
      pi.on("before_agent_start", (_payload, eventCtx) => {
        const surface = readSessionSurface(eventCtx)
        if (surface.id === "unknown-session") return undefined
        const state = sessions.get(surface.id)
        if (state?.context !== undefined) return undefined
        if (state !== undefined && !state.enabled) return undefined
        bindSession(surface, eventCtx, { existing: state, verifyRepository: true })
        return undefined
      })
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
        releaseSession(sessions.get(surface.id))
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
        releaseSession(state)
        sessions.delete(sessionId)
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

function releaseSession(state: SessionState | undefined): void {
  if (state?.context === undefined) return
  memoryModuleSupervisor.release()
  state.context = undefined
}

function readSessionSurface(value: unknown): SessionSurface {
  if (!isRecord(value)) return { entries: [], id: "unknown-session" }
  const manager = isRecord(value.sessionManager) ? value.sessionManager : undefined
  const getSessionId = manager?.getSessionId
  const getEntries = manager?.getEntries
  const id = typeof getSessionId === "function" ? Reflect.apply(getSessionId, manager, []) : "unknown-session"
  const entries = typeof getEntries === "function" ? Reflect.apply(getEntries, manager, []) : []
  const ui = isSessionUi(value.ui) ? value.ui : undefined
  return {
    entries: Array.isArray(entries) ? entries : [],
    id: typeof id === "string" && id.length > 0 ? id : "unknown-session",
    ...(ui === undefined ? {} : { ui }),
    ...(typeof value.hasUI === "boolean" ? { hasUI: value.hasUI } : {}),
  }
}

function isSessionUi(value: unknown): value is SessionUi {
  return isRecord(value) && typeof value.notify === "function"
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
