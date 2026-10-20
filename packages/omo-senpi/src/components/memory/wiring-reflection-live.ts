import { join } from "node:path"

import type { ReservedRun } from "@oh-my-opencode/memory-core"

import { createOncePerSessionGuard } from "../task/usage-guidance"
import type { SenpiExtensionAPI } from "../../extension/types"
import { hasMemoryCapabilities } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { resolveMemorySettings } from "./identity-runtime"
import type { MemoryFactsApplier } from "./facts-apply-rpc"
import { createMemoryRpcBridge, type MemoryRpcBridge } from "./memory-rpc-bridge"
import { resolveAgentReflectionSettings } from "./reflection-settings"
import { isStaleExtensionContextError } from "./stale-extension-context"
import { MEMORY_STATUS_KEY, refreshMemoryStatus } from "./status"
import { createActiveReflectionRuns } from "./status-active-runs"
import { createMemoryFooterStatusLive } from "./status-live-wiring"
import {
  consumePendingReflectionCompletions,
  emitReflectionHealthAlert,
  emitReflectionParkAlert,
  type ReflectionCompletionApi,
  type ReflectionLiveSession,
} from "./worker"
import { describeReflectionLauncher } from "./worker/launcher-identity"
import { readUi } from "./wiring-context"
import type { MemoryWiringOptions, StatusUi } from "./wiring-types"

export interface MemoryReflectionLiveWiring {
  currentSession(): ReflectionLiveSession | undefined
  registerRpc(pi: SenpiExtensionAPI, resolveContext: (sessionId: string) => MemoryIdentityContext | undefined, applyFacts?: MemoryFactsApplier): void
  attach(sessionId: string): void
  bind(
    pi: SenpiExtensionAPI,
    sessionId: string,
    identity: MemoryIdentityContext,
    eventCtx: unknown,
    requestPressureDream: () => void,
  ): Promise<void>
  onReflectionLaunched(identity: string, run: ReservedRun): Promise<void>
  onLiveReflectionCompleted(identity: string, runId: string): Promise<void>
  onSettled(sessionId: string, eventCtx: unknown): Promise<void>
  syncRpc(): Promise<void>
  shutdown(identity?: string): void
  /** Resolves once every status refresh started by bind or settle has finished (each one runs git in the identity dir). */
  settled(): Promise<void>
  clearStatus(eventCtx: unknown): void
}

// A pi captured at bind is retired by session replacement or runtime reload. Under --multi-session
// the RPC host replaces sessions inside one long-lived process, so a reflection run launched off a
// reservation right at boot can probe a ctx retired before the first fresh bind (#7946).
export function createReflectionCompletionApi(pi: SenpiExtensionAPI): ReflectionCompletionApi | undefined {
  if (!hasMemoryCapabilities(pi)) return undefined
  return {
    // Best-effort journal writes: a stale pi means the session this entry would journal into is
    // gone, so swallow the guard's throw instead of letting it kill the reflection run upstream.
    appendEntry: (customType, data) => {
      try {
        pi.appendEntry(customType, data)
      } catch (error) {
        if (!isStaleExtensionContextError(error)) throw error
      }
    },
    registerEntryRenderer: (customType, renderer) => {
      try {
        pi.registerEntryRenderer(customType, renderer)
      } catch (error) {
        if (!isStaleExtensionContextError(error)) throw error
      }
    },
  }
}

export function createMemoryReflectionLiveWiring(
  options: MemoryWiringOptions,
  activeSession: { current?: string },
  lastEventCtx: { current?: unknown },
): MemoryReflectionLiveWiring {
  const activeRuns = createActiveReflectionRuns()
  const healthAlertOnce = createOncePerSessionGuard()
  const liveSession: { current?: ReflectionLiveSession } = {}
  const rpcBridge: { current?: MemoryRpcBridge } = {}
  const statusRefreshes = new Set<Promise<unknown>>()
  const track = (refresh: Promise<unknown>): void => {
    const tracked: Promise<unknown> = refresh.catch(() => {}).finally(() => statusRefreshes.delete(tracked))
    statusRefreshes.add(tracked)
  }
  const footerLive = createMemoryFooterStatusLive({
    resolveContext: (sessionId) => options.sessions.get(sessionId)?.context,
    isActive: (identity) => activeRuns.isActive(identity),
    ...(options.footerTimers === undefined ? {} : { timers: options.footerTimers }),
  })

  async function onReflectionLaunched(identity: string, run: ReservedRun): Promise<void> {
    activeRuns.start(identity, run.runId, launchDetails(options, identity, run))
    footerLive.syncActive(activeSession.current, readUi(lastEventCtx.current))
    await rpcBridge.current?.sync()
  }

  async function onLiveReflectionCompleted(identity: string, runId: string): Promise<void> {
    activeRuns.settle(identity, runId)
    const ui = readUi(lastEventCtx.current)
    footerLive.syncActive(activeSession.current, ui)
    await footerLive.refresh(activeSession.current, ui)
    await rpcBridge.current?.sync()
  }

  return {
    currentSession: () => liveSession.current,
    registerRpc(pi, resolveContext, applyFacts): void {
      rpcBridge.current = createMemoryRpcBridge(pi, {
        resolveContext,
        activeRun: (identity) => activeRuns.current(identity),
        ...(applyFacts === undefined ? {} : { applyFacts }),
      })
    },
    attach(sessionId): void {
      rpcBridge.current?.attach(sessionId)
    },
    async bind(pi, sessionId, identity, eventCtx, requestPressureDream): Promise<void> {
      const ui = readUi(eventCtx)
      const api = createReflectionCompletionApi(pi)
      liveSession.current = api === undefined
        ? undefined
        : {
            sessionId,
            api,
            identityContext: identity,
            ...(ui === undefined ? {} : { ui }),
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          }
      const initialStatus = refreshInitialStatus(options, sessionId, identity, ui, requestPressureDream)
      if (initialStatus !== undefined) track(initialStatus)
      if (liveSession.current !== undefined) {
        try {
          await drainCompletions(
            identity,
            liveSession.current,
            activeRuns.settle,
            healthAlertOnce,
            describeReflectionLauncher({
              env: options.env,
              execPath: process.execPath,
              pid: process.pid,
              sessionId,
            }),
          )
          footerLive.syncActive(sessionId, ui)
          await footerLive.refresh(sessionId, ui)
        } catch (error) {
          options.logger?.warn("memory reflection completion drain failed", { error: describe(error) })
        }
      }
      await rpcBridge.current?.sync()
    },
    onReflectionLaunched,
    onLiveReflectionCompleted,
    async onSettled(sessionId, eventCtx): Promise<void> {
      track(footerLive.refresh(sessionId, readUi(eventCtx)))
      await rpcBridge.current?.sync()
    },
    async syncRpc(): Promise<void> {
      await rpcBridge.current?.sync()
    },
    shutdown(identity): void {
      if (identity !== undefined) activeRuns.clear(identity)
      footerLive.dispose()
      rpcBridge.current?.detach()
    },
    async settled(): Promise<void> {
      while (statusRefreshes.size > 0) await Promise.all([...statusRefreshes])
      await footerLive.settled()
    },
    clearStatus(eventCtx): void {
      footerLive.stop()
      readUi(eventCtx)?.setStatus(MEMORY_STATUS_KEY, undefined)
    },
  }
}

function launchDetails(options: MemoryWiringOptions, identity: string, run: ReservedRun) {
  const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
  return {
    trigger: run.request.trigger,
    category: resolveAgentReflectionSettings(settings, identity).category,
    startedAt: run.reservedAt ?? new Date((options.now ?? Date.now)()).toISOString(),
  }
}

function refreshInitialStatus(
  options: MemoryWiringOptions,
  sessionId: string,
  identity: MemoryIdentityContext,
  ui: StatusUi | undefined,
  requestPressureDream: () => void,
): Promise<unknown> | undefined {
  if (ui === undefined) return undefined
  const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
  return refreshMemoryStatus({
    context: identity,
    ui,
    compileWarnTokens: settings.compile_warn_tokens,
    alreadyNotified: false,
    requestPressureDream,
    sessionId,
  })
}

async function drainCompletions(
  identity: MemoryIdentityContext,
  liveSession: ReflectionLiveSession,
  settle: (identity: string, runId: string) => void,
  healthAlertOnce: (key: string) => boolean,
  currentLauncher: ReturnType<typeof describeReflectionLauncher>,
): Promise<void> {
  const completionsDir = join(identity.identityPaths.reflection, "completions")
  const consumed = await consumePendingReflectionCompletions(completionsDir, identity.identity, liveSession)
  for (const record of consumed) settle(identity.identity, record.runId)
  const observedRunIds = consumed
    .filter((record) => record.outcome !== "merged" && record.outcome !== "no_changes")
    .map((record) => record.runId)
  await emitReflectionHealthAlert(completionsDir, identity.identity, liveSession, healthAlertOnce, {
    observedRunIds,
    currentLauncher,
  })
  await emitReflectionParkAlert(identity.identityPaths.reflection, identity.identity, liveSession, healthAlertOnce)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
