import { join } from "node:path"

import { TranscriptJournal, sanitizeToSlug, type ReservedRun } from "@oh-my-opencode/memory-core"

import { resolveAgentHome } from "../agent-home/resolve-agent-home"
import type { MemoryIdentityContext } from "./context"
import type { DreamTriggerSession } from "./dream-trigger"
import { FactsExtractorRunner } from "./facts-runner"
import { createMemoryFactsWiring, type MemoryFactsWiring } from "./facts-wiring"
import {
  createIdentityRuntime,
  resolveMemorySettings,
  type MemoryIdentityRuntime,
  type MemoryIdentityRuntimeDeps,
} from "./identity-runtime"
import { createMemoryJournalWiring, type MemoryJournalWiring } from "./journal-wiring"
import { resolveMemorySessionModel } from "./session-model-resolver"
import { NO_LAUNCH_FACTS, currentLaunchScope, factsForScope, readLaunchFacts, withLaunchScope, type LaunchFacts } from "./launch-facts"
import { isStaleExtensionContextError } from "./stale-extension-context"
import { resolveReflectionTriggerConfig, type ReflectionTriggerSession } from "./trigger-wiring"
import { isRecord, sessionIdFrom } from "./wiring-context"
import type { MemoryWiringOptions } from "./wiring-types"
import type { ReflectionLiveSession, ReflectionSessionModel } from "./worker"

export interface MemoryRuntimeWiring {
  resolveContext(sessionId: string): MemoryIdentityContext | undefined
  resolveModelRegistry(): ReturnType<MemoryIdentityRuntimeDeps["resolveModelRegistry"]>
  journalWiringFor(identity: MemoryIdentityContext): MemoryJournalWiring
  factsWiringFor(identity: MemoryIdentityContext): MemoryFactsWiring
  runtimeFor(identity: MemoryIdentityContext): MemoryIdentityRuntime
  /** Resolves once every reflection launch started by this wiring's runtimes has returned. */
  settled(): Promise<void>
  triggerSessionFor(eventCtx: unknown): ReflectionTriggerSession | undefined
  dreamSessionById(sessionId: string): DreamTriggerSession | undefined
  dreamSessionFor(eventCtx: unknown): DreamTriggerSession | undefined
}

export interface MemoryRuntimeWiringHooks {
  /** Fires at the real launch site so the footer can animate while the run is in flight. */
  readonly onLaunch?: (identity: string, run: ReservedRun) => void | Promise<void>
  /** Fires after a completion was delivered directly to the currently bound session. */
  readonly onLiveCompletion?: (identity: string, runId: string) => void | Promise<void>
}

export function createMemoryRuntimeWiring(
  options: MemoryWiringOptions,
  lastEventCtx: { current?: unknown },
  liveSession?: () => ReflectionLiveSession | undefined,
  hooks: MemoryRuntimeWiringHooks = {},
): MemoryRuntimeWiring {
  const runtimes = new Map<string, MemoryIdentityRuntime>()
  const journals = new Map<string, MemoryJournalWiring>()
  const factsWirings = new Map<string, MemoryFactsWiring>()

  const resolveContext = (sessionId: string): MemoryIdentityContext | undefined =>
    options.sessions.get(sessionId)?.context

  // Launch facts are bound to the run (launch-facts.ts): a trigger launch reads only its own
  // immutable snapshot, any other launch reads the current ctx only when it belongs to the run.
  function currentLaunchFacts(): LaunchFacts {
    const scope = currentLaunchScope()
    if (scope?.snapshot !== undefined) return scope.snapshot
    const current = lastEventCtx.current
    let live: LaunchFacts
    try {
      live = readLaunchFacts(current)
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error
      live = NO_LAUNCH_FACTS
    }
    // Outside any launch (a facts launch without a captured selection) no session's own details apply:
    // only the process-wide model registry, never whichever session happens to be current.
    if (scope === undefined) return { ...NO_LAUNCH_FACTS, modelRegistry: live.modelRegistry }
    let currentSessionId: string | undefined
    try {
      currentSessionId = sessionIdFrom(current)
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error
    }
    return factsForScope(scope, currentSessionId, live)
  }

  function resolveModelRegistry(): ReturnType<MemoryIdentityRuntimeDeps["resolveModelRegistry"]> {
    return currentLaunchFacts().modelRegistry
  }

  function resolveSessionModel(): ReflectionSessionModel | undefined {
    return currentLaunchFacts().sessionModel
  }

  function resolveParentContextTokens(): number | undefined {
    return currentLaunchFacts().parentContextTokens
  }

  function resolveParentSessionFile(): string | undefined {
    return currentLaunchFacts().parentSessionFile
  }

  function resolveParentCacheReusable(): boolean {
    return currentLaunchFacts().parentCacheReusable
  }

  function snapshotLaunchFacts(eventCtx: unknown): LaunchFacts | undefined {
    try {
      return readLaunchFacts(eventCtx)
    } catch (error) {
      if (!isStaleExtensionContextError(error)) {
        options.logger?.warn("memory reflection could not read its session details at trigger time; the launch reads them later", { error: error instanceof Error ? error.message : String(error) })
      }
      return undefined
    }
  }

  function ownSessionModel(identity: MemoryIdentityContext): ReflectionSessionModel | undefined {
    const current = lastEventCtx.current
    let sessionId: string | undefined
    let model: ReflectionSessionModel | undefined
    try {
      sessionId = sessionIdFrom(current)
      model = resolveMemorySessionModel(current)
    } catch (error) {
      if (!isStaleExtensionContextError(error)) throw error
      return undefined
    }
    if (sessionId === undefined) return undefined
    return resolveContext(sessionId)?.identity === identity.identity ? model : undefined
  }

  /** The engine's own answer for this session; detection is the fallback for hosts without it. */
  function resolveAgentDir(): string {
    return currentLaunchFacts().agentDir ?? resolveAgentHome({ env: process.env })
  }

  function journalWiringFor(identity: MemoryIdentityContext): MemoryJournalWiring {
    const cached = journals.get(identity.identity)
    if (cached !== undefined) return cached
    const wiring = createMemoryJournalWiring({
      identityPaths: identity.identityPaths,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    })
    journals.set(identity.identity, wiring)
    return wiring
  }

  function factsWiringFor(identity: MemoryIdentityContext): MemoryFactsWiring {
    const cached = factsWirings.get(identity.identity)
    if (cached !== undefined) return cached
    const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
    const createExtractor = options.createFactsExtractor
      ?? ((extractorOptions) => new FactsExtractorRunner(extractorOptions))
    const extractor = createExtractor({
      identity: {
        id: identity.identity,
        safeSlug: sanitizeToSlug(identity.identity),
        paths: identity.identityPaths,
      },
      cwd: options.cwd(),
      loadConfig: () => options.loadConfig({ cwd: options.cwd() }),
      resolveModelRegistry,
      // A facts launch handed no selection (unpark, reconcile, final delta) may use the current
      // session's model only when that session belongs to this identity: never another agent's.
      resolveSessionModel: () => ownSessionModel(identity),
      env: options.env,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    })
    const wiring = createMemoryFactsWiring({
      identity: identity.identity,
      identityPaths: identity.identityPaths,
      factsEnabled: () => {
        const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
        const override = settings.agents[identity.identity]?.facts
        return override?.enabled ?? settings.facts.enabled
      },
      debounceSettles: () => {
        const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
        const override = settings.agents[identity.identity]?.facts
        return override?.debounce_settles ?? settings.facts.debounce_settles
      },
      extractor,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    })
    factsWirings.set(identity.identity, wiring)
    return wiring
  }

  function runtimeFor(identity: MemoryIdentityContext): MemoryIdentityRuntime {
    const cached = runtimes.get(identity.identity)
    if (cached !== undefined) return cached
    const create = options.createRuntime ?? createIdentityRuntime
    const runtime = create(identity, {
      loadConfig: options.loadConfig,
      cwd: options.cwd,
      resolveModelRegistry,
      resolveSessionModel,
      resolveParentContextTokens,
      resolveParentSessionFile,
      resolveParentCacheReusable,
      resolveAgentDir,
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(liveSession === undefined
        ? {}
        : {
            liveSession: () => {
              const live = liveSession()
              if (live === undefined) return live
              return {
                ...live,
                identityContext: identity,
                onCompletion: (runId: string) => hooks.onLiveCompletion?.(identity.identity, runId),
              }
            },
          }),
    })
    runtimes.set(identity.identity, runtime)
    return runtime
  }

  function triggerSessionFor(eventCtx: unknown): ReflectionTriggerSession | undefined {
    const sessionId = sessionIdFrom(eventCtx)
    if (sessionId === undefined) return undefined
    const identity = resolveContext(sessionId)
    if (identity === undefined) return undefined
    const runtime = runtimeFor(identity)
    const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
    return {
      conversationId: sessionId,
      ledger: identity.ledger,
      enabled: resolveReflectionTriggerConfig(settings, identity.identity).enabled,
      engine: {
        evaluate: async (conversationId, event) => {
          lastEventCtx.current = eventCtx
          // Snapshot this session's facts while its ctx is live; a failed read only loses the snapshot
          // (the launch then reads the current ctx), it never blocks the reservation.
          const facts = snapshotLaunchFacts(eventCtx)
          const result = await runtime.store.evaluate(conversationId, event)
          if (result?.status === "active") {
            const run = result.run
            void withLaunchScope({ conversationIds: run.request.conversationIds, ...(facts === undefined ? {} : { snapshot: facts }) }, () => runtime.launch(run))
            await hooks.onLaunch?.(identity.identity, result.run)
          }
          return result
        },
      },
    }
  }

  function dreamSessionById(sessionId: string): DreamTriggerSession | undefined {
    const identity = resolveContext(sessionId)
    if (identity === undefined) return undefined
    const runtime = runtimeFor(identity)
    return {
      conversationId: sessionId,
      identity: identity.identity,
      identityPaths: identity.identityPaths,
      getJournal: async (conversationId) =>
        new TranscriptJournal({ journalDir: join(identity.identityPaths.transcripts, conversationId) }),
      store: runtime.store,
      launch: (run) => runtime.launch(run),
    }
  }

  function dreamSessionFor(eventCtx: unknown): DreamTriggerSession | undefined {
    const sessionId = sessionIdFrom(eventCtx)
    return sessionId === undefined ? undefined : dreamSessionById(sessionId)
  }

  return {
    resolveContext,
    resolveModelRegistry,
    journalWiringFor,
    factsWiringFor,
    runtimeFor,
    async settled(): Promise<void> {
      await Promise.all([...runtimes.values()].map((runtime) => runtime.settled()))
    },
    triggerSessionFor,
    dreamSessionById,
    dreamSessionFor,
  }
}
