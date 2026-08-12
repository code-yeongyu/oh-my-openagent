import { join } from "node:path"

import { MemoryBlockCache, type ReservedRun } from "@oh-my-opencode/memory-core"

import { createOncePerSessionGuard } from "../task/usage-guidance"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { hasMemoryCapabilities } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import { createDreamTriggerWiring, resolveDreamTriggerSettings } from "./dream-trigger"
import { resolveMemorySettings } from "./identity-runtime"
import { createMemoryNudgeWiring } from "./nudge-wiring"
import type { PalacePeopleOptions } from "./palace/people"
import { registerMemoryFilesystemPolicy } from "./policy-guard"
import { createMemoryRpcBridge, type MemoryRpcBridge } from "./memory-rpc-bridge"
import { createShutdownDrain, type ShutdownDrainInput, type ShutdownEvaluator } from "./shutdown-drain"
import { resolveAgentReflectionSettings } from "./reflection-settings"
import { type SkillsUsageTracker } from "./skills-usage"
import { createSoulNoticeWiring } from "./soul-notice"
import { MEMORY_STATUS_KEY, refreshMemoryStatus } from "./status"
import { createActiveReflectionRuns } from "./status-active-runs"
import { createMemoryFooterStatusLive } from "./status-live-wiring"
import {
  consumePendingReflectionCompletions,
  emitReflectionHealthAlert,
  type ReflectionCompletionApi,
  type ReflectionLiveSession,
} from "./worker"
import { branchEntryCount, readUi } from "./wiring-context"
import { createMemoryRuntimeWiring } from "./wiring-runtime"
import { registerMemoryStatic } from "./wiring-static"
import type { MemoryCommandSettings } from "./commands/types"
import type { MemoryWiring, MemoryWiringOptions } from "./wiring-types"

export type { MemorySessionStateLike, MemoryWiring, MemoryWiringOptions } from "./wiring-types"

export function createMemoryWiring(options: MemoryWiringOptions): MemoryWiring {
  const promptCache = new MemoryBlockCache()
  const lastEventCtx: { current?: unknown } = {}
  const activeSession: { current?: string } = {}
  const liveSession: { current?: ReflectionLiveSession } = {}
  const healthAlertOnce = createOncePerSessionGuard()
  const skillsUsageTrackersRef: { current: Map<string, SkillsUsageTracker> } = { current: new Map() }
  const activeRuns = createActiveReflectionRuns()
  // The bridge needs the host API, which only arrives at registration; absent means no rpc surface.
  const rpcBridge: { current?: MemoryRpcBridge } = {}
  const footerLive = createMemoryFooterStatusLive({
    resolveContext: (sessionId) => options.sessions.get(sessionId)?.context,
    isActive: (identity) => activeRuns.isActive(identity),
    ...(options.footerTimers === undefined ? {} : { timers: options.footerTimers }),
  })
  /** Records the launched run and refreshes both live surfaces behind their own change gates. */
  async function onReflectionLaunched(identity: string, run: ReservedRun): Promise<void> {
    activeRuns.start(identity, run.runId, launchDetails(identity, run))
    footerLive.syncActive(activeSession.current, readUi(lastEventCtx.current))
    await rpcBridge.current?.sync()
  }

  /**
   * Launch-time facts only. The concrete model is chosen inside the reflection child, so the
   * snapshot reports the configured category and leaves `model` absent rather than guessing.
   */
  function launchDetails(identity: string, run: ReservedRun) {
    const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
    return {
      trigger: run.request.trigger,
      category: resolveAgentReflectionSettings(settings, identity).category,
      startedAt: run.reservedAt ?? new Date((options.now ?? Date.now)()).toISOString(),
    }
  }
  const runtimeWiring = createMemoryRuntimeWiring(
    options,
    lastEventCtx,
    () => liveSession.current,
    { onLaunch: onReflectionLaunched },
  )
  const { resolveContext, journalWiringFor, factsWiringFor, runtimeFor } = runtimeWiring

  const nudgeWiring = createMemoryNudgeWiring({
    resolveContext,
    resolveSettings: (identity) => {
      const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
      const override = settings.agents[identity]?.nudge
      return {
        enabled: override?.enabled ?? settings.nudge.enabled,
        everyUserTurns: override?.every_user_turns ?? settings.nudge.every_user_turns,
      }
    },
  })
  const soulNoticeWiring = createSoulNoticeWiring({
    resolveContext,
    resolveEditNotice: (identity) => {
      const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
      const override = settings.agents[identity]?.soul
      return override?.edit_notice ?? settings.soul.edit_notice
    },
  })

  async function flushSkillsUsageTrackers(signal?: AbortSignal): Promise<void> {
    for (const tracker of skillsUsageTrackersRef.current.values()) {
      if (signal?.aborted === true) return
      await tracker.flush(signal)
    }
  }

  const shutdownDrain = createShutdownDrain({
    ...(options.logger === undefined ? {} : { logger: options.logger }),
    steps: {
      flushJournal: async (sessionId, signal) => {
        const identity = resolveContext(sessionId)
        if (identity === undefined) return
        await journalWiringFor(identity).journalFor(sessionId).flush(signal)
      },
      enqueueFinalDelta: async (sessionId, signal) => {
        const identity = resolveContext(sessionId)
        if (identity === undefined || signal.aborted) return
        await factsWiringFor(identity).enqueueSettled(sessionId, signal)
      },
      flushSkillsUsage: async (_sessionId, signal) => {
        if (signal.aborted) return
        await flushSkillsUsageTrackers(signal)
      },
      launchFacts: async (sessionId, signal) => {
        const identity = resolveContext(sessionId)
        if (identity === undefined || signal.aborted) return
        await factsWiringFor(identity).launchIfThresholdMet(signal)
      },
    },
  })

  const dreamTriggerWiring = createDreamTriggerWiring({
    resolveSession: (eventCtx) => runtimeWiring.dreamSessionFor(eventCtx),
    resolveActiveSession: () => (activeSession.current === undefined ? undefined : runtimeWiring.dreamSessionById(activeSession.current)),
    resolveSessionById: runtimeWiring.dreamSessionById,
    resolveSettings: (identity) => {
      const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
      return resolveDreamTriggerSettings(settings, identity)
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  shutdownDrain.registerEvaluator(dreamTriggerWiring.shutdownEvaluator())

  function completionApi(pi: SenpiExtensionAPI): ReflectionCompletionApi | undefined {
    if (!hasMemoryCapabilities(pi)) return undefined
    return {
      appendEntry: (customType, data) => {
        pi.appendEntry(customType, data)
      },
      registerEntryRenderer: (customType, renderer) => {
        pi.registerEntryRenderer(customType, renderer)
      },
    }
  }

  /** Palace people-panel gate using the resolved `memory.people` settings. */
  function resolvePalacePeople(): PalacePeopleOptions | undefined {
    const people = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory).people
    return {
      enabled: people.enabled,
      limits: { maxEntries: people.max_entries, maxEntryChars: people.max_entry_chars },
    }
  }

  function loadCommandSettings(): MemoryCommandSettings {
    const resolved = options.loadConfig({ cwd: options.cwd() }).config
    return { settings: resolveMemorySettings(resolved.memory), config: resolved }
  }

  return {
    registerStatic(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      rpcBridge.current = createMemoryRpcBridge(pi, {
        resolveContext,
        activeRun: (identity) => activeRuns.current(identity),
      })
      registerMemoryStatic({
        pi,
        ctx,
        options,
        promptCache,
        nudgeWiring,
        soulNoticeWiring,
        dreamTriggerWiring,
        completionApi,
        resolveContext,
        journalWiringFor,
        factsWiringFor,
        runtimeFor,
        triggerSessionFor: runtimeWiring.triggerSessionFor,
        resolvePalacePeople,
        loadCommandSettings,
        lastEventCtx,
        activeSession,
        skillsUsageTrackersRef,
        onReflectionLaunch: onReflectionLaunched,
        onSettled: async (sessionId, eventCtx) => {
          // The footer stays fire-and-forget; only the rpc snapshot is awaited by the caller.
          void footerLive.refresh(sessionId, readUi(eventCtx))
          await rpcBridge.current?.sync()
        },
        onMemoryWrite: async () => {
          await rpcBridge.current?.sync()
        },
      })
    },

    async afterBind(pi: SenpiExtensionAPI, sessionId: string, identity: MemoryIdentityContext, eventCtx: unknown): Promise<void> {
      activeSession.current = sessionId
      lastEventCtx.current = eventCtx
      rpcBridge.current?.attach(sessionId)
      registerMemoryFilesystemPolicy(pi, identity)
      await runtimeFor(identity).reconcile()
      if (branchEntryCount(eventCtx) > 0) {
        await journalWiringFor(identity).reconcileSession(eventCtx)
      }
      factsWiringFor(identity).reconcileExtractor()
      const ui = readUi(eventCtx)
      const api = completionApi(pi)
      liveSession.current = api === undefined
        ? undefined
        : {
            sessionId,
            api,
            ...(ui === undefined ? {} : { ui }),
            ...(options.logger === undefined ? {} : { logger: options.logger }),
          }
      if (ui !== undefined) {
        const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
        void refreshMemoryStatus({
          context: identity,
          ui,
          compileWarnTokens: settings.compile_warn_tokens,
          alreadyNotified: false,
          sessionId,
        }).catch(() => {})
      }
      if (liveSession.current !== undefined) {
        try {
          const completionsDir = join(identity.identityPaths.reflection, "completions")
          const consumed = await consumePendingReflectionCompletions(completionsDir, identity.identity, liveSession.current)
          // A consumed completion is the settle signal: the run behind it is no longer in flight.
          for (const record of consumed) activeRuns.settle(identity.identity, record.runId)
          await emitReflectionHealthAlert(completionsDir, identity.identity, liveSession.current, healthAlertOnce)
          footerLive.syncActive(sessionId, ui)
          await footerLive.refresh(sessionId, ui)
        } catch (error) {
          options.logger?.warn("memory reflection completion drain failed", { error: describe(error) })
        }
      }
      // Published last so the bind snapshot reflects the drained backlog, not the pre-drain state.
      await rpcBridge.current?.sync()
    },

    async flushSkillsUsage(): Promise<void> {
      await flushSkillsUsageTrackers()
    },

    async onSessionShutdown(input: ShutdownDrainInput): Promise<void> {
      const identity = options.sessions.get(input.sessionId)?.context
      if (identity !== undefined) activeRuns.clear(identity.identity)
      // A leaked interval outlives the session, so the animation stops before the drain runs.
      footerLive.dispose()
      rpcBridge.current?.detach()
      await shutdownDrain.run(input)
    },

    registerShutdownEvaluator(evaluator: ShutdownEvaluator): void {
      shutdownDrain.registerEvaluator(evaluator)
    },

    clearStatus(eventCtx: unknown): void {
      // Clearing the footer must also kill the animation, or the interval repaints what was cleared.
      footerLive.stop()
      readUi(eventCtx)?.setStatus(MEMORY_STATUS_KEY, undefined)
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
