// Session binding for the memory component: the host's session surface, the per-session state,
// and the bind that resolves the session's identity, records its binding, and acquires the
// memory module supervisor and the end-to-end encrypted sync runner for durable sessions.

import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import { resolveMemoryIdentity, resolveMemoryRoot } from "@oh-my-opencode/memory-core"

import type { ComponentContext } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { MEMORY_BINDING_CUSTOM_TYPE, createMemoryBinding, findLatestMemoryBinding, type SessionEntryLike } from "./binding"
import { logBindReconcileFailure } from "./bind-reconcile-log"
import type { MemoryExtensionAPI } from "./capabilities"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { adoptSessionIdentity } from "./identity-adoption"
import { memoryModuleSupervisor } from "./supervisor"
import type { SyncRunner } from "./sync-runner"
import { isOneShotSurface, resolveIdentityRunPaths, type IdentityRunPaths } from "./transient-identity"
import type { createMemoryWiring } from "./wiring"

export type SessionUi = { notify(message: string, level: "error" | "warning"): void }
export type SessionSurface = {
  /**
   * The session's full history, read only when a bind needs its recorded binding. On a reopened
   * compacted session `getEntries()` re-parses the whole transcript file and keeps it until the session
   * settles idle, so reading it eagerly on every `before_agent_start` pinned about four times the
   * transcript for each run (senpi#3110).
   */
  readonly readEntries: () => readonly SessionEntryLike[]
  readonly id: string
  readonly ui?: SessionUi
  readonly hasUI?: boolean
  /** The session's own working directory, reported by the host per event. */
  readonly cwd?: string
}
export type SessionState = {
  readonly enabled: boolean
  readonly ui?: SessionUi
  context?: MemoryIdentityContext
  /** Where this session's identity storage lives; finalized (transient root reclaimed) at shutdown. */
  run?: IdentityRunPaths
  memoryStatusAttempted: boolean
  /** The repository this session holds the sync runner for; released with the binding. */
  syncRepo?: string
  restartNotified: boolean
  conflictNotified: boolean
}

export interface SessionBinderDeps {
  readonly pi: MemoryExtensionAPI
  readonly ctx: ComponentContext
  readonly env: Record<string, string | undefined>
  readonly now: () => number
  readonly cwd: string
  readonly loadConfig: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly sessions: Map<string, SessionState>
  readonly wiring: Pick<ReturnType<typeof createMemoryWiring>, "afterBind">
  readonly syncRunner: SyncRunner
  readonly isEnabled: (config: OmoMemorySettings) => boolean
  readonly resolveConfig: (loaded: SenpiOmoConfigResult) => OmoMemorySettings
}

export type SessionBinder = (
  surface: SessionSurface,
  eventCtx: unknown,
  options: { readonly existing: SessionState | undefined; readonly verifyRepository: boolean },
) => void

export function createSessionBinder(deps: SessionBinderDeps): SessionBinder {
  const { pi, ctx, env, now, cwd, loadConfig, sessions, wiring, syncRunner } = deps
  return (
    surface: SessionSurface,
    eventCtx: unknown,
    options: { readonly existing: SessionState | undefined; readonly verifyRepository: boolean },
  ): void => {
    const sessionConfig = deps.resolveConfig(loadConfig({ cwd }))
    const state: SessionState = options.existing ?? {
      enabled: deps.isEnabled(sessionConfig),
      memoryStatusAttempted: false,
      restartNotified: false,
      conflictNotified: false,
      ...(surface.ui === undefined ? {} : { ui: surface.ui }),
    }
    sessions.set(surface.id, state)
    if (!state.enabled) return

    // The identity belongs to the SESSION's workspace, not to whatever directory the host
    // process happens to sit in: one shared host serves sessions from many workspaces (#8556).
    const sessionCwd = surface.cwd ?? cwd
    const memoryRoot = resolveMemoryRoot(env, sessionCwd)
    const resolved = resolveMemoryIdentity(sessionConfig.agent, sessionCwd, env)
    const previous = findLatestMemoryBinding(surface.readEntries())
    const adoption = adoptSessionIdentity({
      recorded: previous,
      resolved,
      memoryRoot,
      configAgentValue: sessionConfig.agent,
      verifyRepository: options.verifyRepository,
    })
    if (adoption.kind === "conflict") {
      if (!state.conflictNotified) {
        state.conflictNotified = true
        surface.ui?.notify(
          `memory identity conflict: session is bound to ${previous?.identity}, but config resolved ${resolved.id}; restart with the original identity or fork a new session`,
          "error",
        )
        ctx.logger.warn("omo-senpi memory binding failed closed", {
          sessionId: surface.id,
          bound: previous?.identity,
          resolved: resolved.id,
        })
      }
      return
    }
    const identity = adoption.identity
    if (adoption.kind === "rebound") {
      ctx.logger.info("omo-senpi memory identity rebound to the session binding", {
        sessionId: surface.id,
        bound: identity.id,
        resolved: resolved.id,
      })
    }
    const binding = createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: now() })

    const oneShot = isOneShotSurface({ hasUI: surface.hasUI, env, pi })
    const run = resolveIdentityRunPaths({
      identity: identity.id,
      identityPaths: identity.paths,
      memoryRoot,
      oneShot,
    })
    state.run = run
    state.context = createMemoryIdentityContext({
      identity: identity.id,
      identityPaths: run.paths,
      durableRoot: run.durableRoot,
      binding,
    })
    memoryModuleSupervisor.acquire()
    if (!oneShot) {
      state.syncRepo = identity.paths.repo
      void syncRunner.acquire(identity.id, identity.paths, sessionConfig.sync)
    }
    // Disposable bookkeeping: a session closed without a conversation leaves no file (senpi#3263).
    pi.appendEntry(MEMORY_BINDING_CUSTOM_TYPE, binding, { startupBookkeeping: true })
    // Bind-time reconcile floats past the bind by design, but its rejection must not
    // float: an unhandled rejection is attributed to whatever code is running when it lands.
    void wiring.afterBind(pi, surface.id, state.context, eventCtx).catch((error: unknown) => {
      logBindReconcileFailure(ctx.logger, error)
    })
  }
}

export function releaseSession(state: SessionState | undefined, syncRunner?: SyncRunner): void {
  if (state?.context === undefined) return
  memoryModuleSupervisor.release()
  state.context = undefined
  if (state.syncRepo !== undefined && syncRunner !== undefined) void syncRunner.release(state.syncRepo)
  state.syncRepo = undefined
}

export function readSessionSurface(value: unknown): SessionSurface {
  if (!isRecord(value)) return { readEntries: () => [], id: "unknown-session" }
  const manager = isRecord(value.sessionManager) ? value.sessionManager : undefined
  const getSessionId = manager?.getSessionId
  const getEntries = manager?.getEntries
  const id = typeof getSessionId === "function" ? Reflect.apply(getSessionId, manager, []) : "unknown-session"
  const readEntries = (): readonly SessionEntryLike[] => {
    const entries: unknown = typeof getEntries === "function" ? Reflect.apply(getEntries, manager, []) : []
    return Array.isArray(entries) ? entries : []
  }
  const ui = isSessionUi(value.ui) ? value.ui : undefined
  return {
    readEntries,
    id: typeof id === "string" && id.length > 0 ? id : "unknown-session",
    ...(ui === undefined ? {} : { ui }),
    ...(typeof value.hasUI === "boolean" ? { hasUI: value.hasUI } : {}),
    ...(typeof value.cwd === "string" && value.cwd.length > 0 ? { cwd: value.cwd } : {}),
  }
}

function isSessionUi(value: unknown): value is SessionUi {
  return isRecord(value) && typeof value.notify === "function"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
