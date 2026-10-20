import { MemoryBlockCache } from "@oh-my-opencode/memory-core"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { buildDreamTriggerWiring } from "./dream-runtime-wiring"
import { resolveMemorySettings } from "./identity-runtime"
import { createMemoryMaintenance } from "./memory-maintenance"
import { createMemoryNudgeWiring } from "./nudge-wiring"
import type { PalacePeopleOptions } from "./palace/people"
import { registerMemoryFilesystemPolicy } from "./policy-guard"
import { createShutdownDrain, type ShutdownDrainInput, type ShutdownEvaluator } from "./shutdown-drain"
import { type SkillsUsageTracker } from "./skills-usage"
import { type MemoryUsageTracker } from "./memory-usage"
import { createMemoryNoticeWiring } from "./memory-notice-wiring"
import { createConfiguredFactsApplier, publishSessionFactsApplier } from "./facts-apply-rpc"
import { createKibitzerComposition, type KibitzerComposition } from "./kibitzer"
import { createPressureDreamAdmission } from "./pressure-dream-admission"
import { createMemoryRecallWiring, createSharedRecallCorpusCache } from "./recall-wiring"
import { branchEntryCount, sessionIdFrom } from "./wiring-context"
import { createMemoryUserActivity } from "./user-activity"
import { logBindReconcileFailure } from "./bind-reconcile-log"
import {
  createMemoryReflectionLiveWiring,
  createReflectionCompletionApi,
} from "./wiring-reflection-live"
import { createMemoryRuntimeWiring } from "./wiring-runtime"
import { registerMemoryStatic } from "./wiring-static"
import type { MemoryCommandSettings } from "./commands/types"
import type { MemoryWiring, MemoryWiringOptions } from "./wiring-types"

export type { MemorySessionStateLike, MemoryWiring, MemoryWiringOptions } from "./wiring-types"

export function createMemoryWiring(options: MemoryWiringOptions): MemoryWiring {
  const promptCache = new MemoryBlockCache()
  const lastEventCtx: { current?: unknown } = {}
  const activeSession: { current?: string } = {}
  const userActivity = createMemoryUserActivity(options.env)
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
  const corpusCache = (options.createCorpusCache ?? createSharedRecallCorpusCache)(options.logger)

  const recallWiring = createMemoryRecallWiring({
    resolveContext,
    resolveSettings: () => resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory),
    env: options.env,
    corpusCache,
    drainQueued: (sessionId, context) => deliveryRef.current?.drainForPrompt(sessionId, context) ?? [],
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  const kibitzerRef: { current?: KibitzerComposition } = {}
  const maintenance = (options.createMaintenance ?? createMemoryMaintenance)({
    isLiveSession: (sessionId) => options.sessions.has(sessionId),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })

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

  const dreamTriggerWiring = buildDreamTriggerWiring(options, runtimeWiring, activeSession, userActivity.has)
  const pressureDreamAdmission = createPressureDreamAdmission({
    request: (sessionId) => dreamTriggerWiring.requestPressureDream(sessionId),
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
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
      userActivity.register(pi)
      const applyFacts = createConfiguredFactsApplier(options, (sessionId) => resolveContext(sessionId ?? activeSession.current ?? ""))
      reflectionLive.registerRpc(pi, resolveContext, applyFacts)
      publishSessionFactsApplier(applyFacts)
      const kibitzer = createKibitzerComposition({
        env: options.env,
        cwd: options.cwd,
        loadConfig: options.loadConfig,
        resolveContext: (sessionId) => userActivity.hasInput(sessionId) ? resolveContext(sessionId) : undefined,
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
        triggerSessionFor: (eventCtx) => {
          const sessionId = sessionIdFrom(eventCtx)
          return sessionId !== undefined && userActivity.has(sessionId) ? runtimeWiring.triggerSessionFor(eventCtx) : undefined
        },
        resolvePalacePeople,
        loadCommandSettings,
        lastEventCtx,
        activeSession,
        skillsUsageTrackersRef,
        memoryUsageTrackersRef,
        hasUserActivity: userActivity.has,
        onReflectionLaunch: reflectionLive.onReflectionLaunched,
        onSettled: async (sessionId, eventCtx) => {
          const identity = resolveContext(sessionId)
          if (identity !== undefined) {
            await userActivity.reconcileOnce(sessionId, async () => {
              try {
                await runtimeFor(identity).reconcile()
              } catch (error) {
                if (options.logger !== undefined) logBindReconcileFailure(options.logger, error)
              }
              pressureDreamAdmission.requestDeferred(sessionId)
            })
          }
          await reflectionLive.onSettled(sessionId, eventCtx)
        },
        onMemoryWrite: reflectionLive.syncRpc,
      })
    },

    async afterBind(pi, sessionId, identity, eventCtx): Promise<void> {
      activeSession.current = sessionId
      userActivity.reset(sessionId)
      pressureDreamAdmission.reset(sessionId)
      lastEventCtx.current = eventCtx
      reflectionLive.attach(sessionId)
      registerMemoryFilesystemPolicy(pi, identity)
      maintenance.schedule(identity)
      if (branchEntryCount(eventCtx) > 0) {
        await journalWiringFor(identity).reconcileSession(eventCtx)
      }
      factsWiringFor(identity).reconcileExtractor(sessionId)
      await reflectionLive.bind(
        pi,
        sessionId,
        identity,
        eventCtx,
        () => {
          pressureDreamAdmission.deferOrRequest(sessionId, userActivity.has(sessionId))
        },
      )
    },

    async flushSkillsUsage(): Promise<void> {
      await flushSkillsUsageTrackers()
    },

    async onSessionShutdown(input: ShutdownDrainInput): Promise<void> {
      // Background packing is never worth holding an exit for: stop it before the drain.
      maintenance.dispose()
      // The journal flush runs FIRST, before the pre-drain awaits can consume the fixed budget:
      // the transcript bytes are already on disk (append writes immediately, flush is fsync), so
      // one first-position flush captures everything and the drain must never re-run it.
      const journalFlushed = await shutdownDrain.flushJournal(input)
      // dispose() stops a running pass but does not wait for it, and the bind/settle status refreshes
      // run git in the identity dir unawaited. Work still running there holds its files open past
      // shutdown, which Windows reports as EBUSY/EFAULT on the next remove (#10154).
      await shutdownDrain.raceDetached(input, "maintenance-settle", () => maintenance.settled())
      await shutdownDrain.raceDetached(input, "status-settle", () => reflectionLive.settled())
      // A recall ranking saves the repository's terms into its `.git` after the prompt; let that write finish.
      await shutdownDrain.raceDetached(input, "recall-store-settle", () => corpusCache.settled())
      reflectionLive.shutdown(options.sessions.get(input.sessionId)?.context?.identity)
      // senpi awaits this handler with no host cap, so neither cleanup may be awaited past the
      // drain deadline: both are started and raced against it, and whichever loses keeps running
      // detached (the Kibitzer wake lease and the sidecar directory lock are still released).
      const kibitzer = kibitzerRef.current
      if (kibitzer !== undefined) {
        await shutdownDrain.raceDetached(input, "kibitzer-shutdown", () => kibitzer.onSessionShutdown(input.sessionId))
      }
      const identity = resolveContext(input.sessionId)
      if (identity !== undefined) {
        const facts = factsWiringFor(identity)
        if (facts.cancelActive !== undefined) {
          await shutdownDrain.raceDetached(input, "facts-cancel", async () => { await facts.cancelActive?.() })
        }
      }
      await shutdownDrain.run(input, { journalFlushed })
      // A reflection launch runs its child under the identity dir too. It is awaited last, on what
      // budget is left: a run that outlives it keeps going detached (by design), and it never
      // displaces the drain's own steps (#10154).
      await shutdownDrain.raceDetached(input, "reflection-launch-settle", () => runtimeWiring.settled())
      pressureDreamAdmission.reset(input.sessionId)
      userActivity.reset(input.sessionId)
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
