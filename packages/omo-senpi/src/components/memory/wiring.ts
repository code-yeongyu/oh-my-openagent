import { MemoryBlockCache, RecallCorpusCache } from "@oh-my-opencode/memory-core"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { createDreamTriggerWiring, resolveDreamTriggerSettings } from "./dream-trigger"
import { resolveMemorySettings } from "./identity-runtime"
import { createMemoryNudgeWiring } from "./nudge-wiring"
import type { PalacePeopleOptions } from "./palace/people"
import { registerMemoryFilesystemPolicy } from "./policy-guard"
import { createShutdownDrain, type ShutdownDrainInput, type ShutdownEvaluator } from "./shutdown-drain"
import { type SkillsUsageTracker } from "./skills-usage"
import { type MemoryUsageTracker } from "./memory-usage"
import { createMemoryNoticeWiring } from "./memory-notice-wiring"
import { createKibitzerComposition, type KibitzerComposition } from "./kibitzer"
import { createMemoryRecallWiring } from "./recall-wiring"
import { branchEntryCount } from "./wiring-context"
import {
  createMemoryReflectionLiveWiring,
  createReflectionCompletionApi,
} from "./wiring-reflection-live"
import { createMemoryRuntimeWiring, type MemoryRuntimeWiring } from "./wiring-runtime"
import { registerMemoryStatic } from "./wiring-static"
import type { MemoryCommandSettings } from "./commands/types"
import type { MemoryWiring, MemoryWiringOptions } from "./wiring-types"

export type { MemorySessionStateLike, MemoryWiring, MemoryWiringOptions } from "./wiring-types"

export function createMemoryWiring(options: MemoryWiringOptions): MemoryWiring {
  const promptCache = new MemoryBlockCache()
  const lastEventCtx: { current?: unknown } = {}
  const activeSession: { current?: string } = {}
  const skillsUsageTrackersRef: { current: Map<string, SkillsUsageTracker> } = { current: new Map() }
  const memoryUsageTrackersRef: { current: Map<string, MemoryUsageTracker> } = { current: new Map() }
  const reflectionLive = createMemoryReflectionLiveWiring(options, activeSession, lastEventCtx)
  const runtimeWiring = createMemoryRuntimeWiring(
    options,
    lastEventCtx,
    reflectionLive.currentSession,
    {
      onLaunch: reflectionLive.onReflectionLaunched,
      onLiveCompletion: reflectionLive.onLiveReflectionCompleted,
    },
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
  const noticeWiring = createMemoryNoticeWiring({
    resolveContext,
    resolveEditNotice: (identity) => {
      const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
      const override = settings.agents[identity]?.soul
      return override?.edit_notice ?? settings.soul.edit_notice
    },
  })

  // Late-bound because the two wirings are mutually dependent by design: recall's drain injects the
  // nudges the Kibitzer composition holds, and the composition wakes its sidecars from recall's
  // collection. The composition is built in registerStatic, before any hook can fire.
  const deliveryRef: { current?: KibitzerComposition["delivery"] } = {}
  // One corpus cache for both: the sidecar's read-only memory tool reads the corpus the candidates came from.
  const corpusCache = new RecallCorpusCache()

  const recallWiring = createMemoryRecallWiring({
    resolveContext,
    resolveSettings: () => resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory),
    env: options.env,
    corpusCache,
    drainQueued: (sessionId, context) => deliveryRef.current?.drainForPrompt(sessionId, context) ?? [],
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  const kibitzerRef: { current?: KibitzerComposition } = {}

  async function flushSkillsUsageTrackers(signal?: AbortSignal): Promise<void> {
    for (const tracker of skillsUsageTrackersRef.current.values()) {
      if (signal?.aborted === true) return
      await tracker.flush(signal)
    }
    for (const tracker of memoryUsageTrackersRef.current.values()) {
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
    },
  })

  const dreamTriggerWiring = buildDreamTriggerWiring(options, runtimeWiring, activeSession)
  shutdownDrain.registerEvaluator(dreamTriggerWiring.shutdownEvaluator())

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
      reflectionLive.registerRpc(pi, resolveContext)
      const kibitzer = createKibitzerComposition({
        env: options.env,
        cwd: options.cwd,
        loadConfig: options.loadConfig,
        resolveContext,
        recall: recallWiring,
        corpusCache,
        ...(ctx.idleCoordinator === undefined ? {} : { coordinator: ctx.idleCoordinator }),
        sendMessage: (message, sendOptions) => pi.sendMessage(message, sendOptions),
        appendEntry: (customType, data) => pi.appendEntry?.(customType, data),
        ...(options.kibitzerChildStarter === undefined ? {} : { childStarter: options.kibitzerChildStarter }),
        ...(options.logger === undefined ? {} : { logger: options.logger }),
      })
      kibitzerRef.current = kibitzer
      deliveryRef.current = kibitzer.delivery
      registerMemoryStatic({
        pi,
        ctx,
        options,
        promptCache,
        nudgeWiring,
        noticeWiring,
        recallWiring,
        kibitzer,
        dreamTriggerWiring,
        completionApi: createReflectionCompletionApi,
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
        memoryUsageTrackersRef,
        onReflectionLaunch: reflectionLive.onReflectionLaunched,
        onSettled: reflectionLive.onSettled,
        onMemoryWrite: reflectionLive.syncRpc,
      })
    },

    async afterBind(pi, sessionId, identity, eventCtx): Promise<void> {
      activeSession.current = sessionId
      lastEventCtx.current = eventCtx
      reflectionLive.attach(sessionId)
      registerMemoryFilesystemPolicy(pi, identity)
      await runtimeFor(identity).reconcile()
      if (branchEntryCount(eventCtx) > 0) {
        await journalWiringFor(identity).reconcileSession(eventCtx)
      }
      factsWiringFor(identity).reconcileExtractor()
      const dreamSession = runtimeWiring.dreamSessionById(sessionId)
      if (dreamSession !== undefined) {
        void dreamTriggerWiring.reconcileSessionStart(dreamSession).catch((error: unknown) => {
          options.logger?.warn("omo-senpi memory dream session_start reconcile failed", { error: describe(error) })
        })
      }
      await reflectionLive.bind(
        pi,
        sessionId,
        identity,
        eventCtx,
        () => {
          void dreamTriggerWiring.requestPressureDream(sessionId).catch((error: unknown) => {
            options.logger?.warn("omo-senpi memory pressure dream trigger failed", { error: describe(error) })
          })
        },
      )
    },

    async flushSkillsUsage(): Promise<void> {
      await flushSkillsUsageTrackers()
    },

    async onSessionShutdown(input: ShutdownDrainInput): Promise<void> {
      // The journal flush runs FIRST, before the pre-drain awaits can consume the fixed budget:
      // the transcript bytes are already on disk (append writes immediately, flush is fsync), so
      // one first-position flush captures everything and the drain must never re-run it.
      const journalFlushed = await shutdownDrain.flushJournal(input)
      reflectionLive.shutdown(options.sessions.get(input.sessionId)?.context?.identity)
      await kibitzerRef.current?.onSessionShutdown(input.sessionId)
      const identity = resolveContext(input.sessionId)
      if (identity !== undefined) await factsWiringFor(identity).cancelActive?.()
      await shutdownDrain.run(input, { journalFlushed })
    },

    registerShutdownEvaluator(evaluator: ShutdownEvaluator): void {
      shutdownDrain.registerEvaluator(evaluator)
    },

    clearStatus(eventCtx: unknown): void {
      reflectionLive.clearStatus(eventCtx)
    },

    async whenIdle(): Promise<void> {
      await kibitzerRef.current?.whenIdle()
    },
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function buildDreamTriggerWiring(
  options: MemoryWiringOptions,
  runtimeWiring: MemoryRuntimeWiring,
  activeSession: { current?: string },
) {
  return createDreamTriggerWiring({
    resolveSession: (eventCtx) => runtimeWiring.dreamSessionFor(eventCtx),
    resolveActiveSession: () => activeSession.current === undefined
      ? undefined
      : runtimeWiring.dreamSessionById(activeSession.current),
    resolveSessionById: runtimeWiring.dreamSessionById,
    resolveSettings: (identity) => {
      const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
      return resolveDreamTriggerSettings(settings, identity)
    },
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
}
