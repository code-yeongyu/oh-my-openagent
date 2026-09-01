import { join } from "node:path"

import { TranscriptJournal, sanitizeToSlug, type ReservedRun } from "@oh-my-opencode/memory-core"

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
import { MemorianGateRunner } from "./memorian-runner"
import type { MemorianGatePort } from "./memorian-wiring"
import { resolveMemoryModelRegistry } from "./model-registry-resolver"
import { resolveMemorySessionModel } from "./session-model-resolver"
import {
  resolveParentCacheReusable as resolveParentCacheReusableFromCtx,
  resolveParentContextTokens as resolveParentContextTokensFromCtx,
  resolveParentSessionFile as resolveParentSessionFileFromCtx,
} from "./session-context-resolver"
import { resolveReflectionTriggerConfig, type ReflectionTriggerSession } from "./trigger-wiring"
import { isRecord, sessionIdFrom } from "./wiring-context"
import type { MemoryWiringOptions } from "./wiring-types"
import type { ReflectionLiveSession, ReflectionSessionModel } from "./worker"
import { buildFactsSandboxTransform, buildMemorianSandboxTransform, type SandboxPolicy } from "./sandbox"

export interface MemoryRuntimeWiring {
  resolveContext(sessionId: string): MemoryIdentityContext | undefined
  resolveModelRegistry(): ReturnType<MemoryIdentityRuntimeDeps["resolveModelRegistry"]>
  journalWiringFor(identity: MemoryIdentityContext): MemoryJournalWiring
  factsWiringFor(identity: MemoryIdentityContext): MemoryFactsWiring
  memorianRunnerFor(identity: MemoryIdentityContext): MemorianGatePort
  runtimeFor(identity: MemoryIdentityContext): MemoryIdentityRuntime
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
  const memorianRunners = new Map<string, MemorianGatePort>()

  const resolveContext = (sessionId: string): MemoryIdentityContext | undefined =>
    options.sessions.get(sessionId)?.context

  function resolveModelRegistry(): ReturnType<MemoryIdentityRuntimeDeps["resolveModelRegistry"]> {
    return resolveMemoryModelRegistry(lastEventCtx.current)
  }

  function resolveSessionModel(): ReflectionSessionModel | undefined {
    return resolveMemorySessionModel(lastEventCtx.current)
  }

  function resolveParentContextTokens(): number | undefined {
    return resolveParentContextTokensFromCtx(lastEventCtx.current)
  }

  function resolveParentSessionFile(): string | undefined {
    return resolveParentSessionFileFromCtx(lastEventCtx.current)
  }

  function resolveParentCacheReusable(): boolean {
    return resolveParentCacheReusableFromCtx(lastEventCtx.current)
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
    const sandboxPolicy = settings.agents[identity.identity]?.reflection?.sandbox
      ?? settings.reflection.sandbox
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
      env: options.env,
      sandbox: buildFactsSandboxTransform({
        policy: sandboxPolicy as SandboxPolicy,
        onWarning: (warning, spawnArgs) => options.logger?.warn("memory facts sandbox degraded", {
          identity: identity.identity,
          runId: spawnArgs.runId,
          warning,
        }),
      }),
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

  /**
   * One gate runner per identity: the runner owns the single-launch latch, so a shared instance is
   * what keeps repeated settles down to one child.
   */
  function memorianRunnerFor(identity: MemoryIdentityContext): MemorianGatePort {
    const cached = memorianRunners.get(identity.identity)
    if (cached !== undefined) return cached
    const settings = resolveMemorySettings(options.loadConfig({ cwd: options.cwd() }).config.memory)
    // The gate adds no sandbox knob of its own: it rides the reflection policy the facts child uses.
    const sandboxPolicy = settings.agents[identity.identity]?.reflection?.sandbox ?? settings.reflection.sandbox
    // No resolveModelRegistry here on purpose: the gate runner consumes ONLY the registry snapshot
    // its settle handler captured, because this runner's launches outlive the senpi ctx.
    const runner = options.createMemorianRunner?.(identity) ?? new MemorianGateRunner({
      identityPaths: identity.identityPaths,
      loadConfig: () => options.loadConfig({ cwd: options.cwd() }),
      env: options.env,
      sandbox: buildMemorianSandboxTransform({
        policy: sandboxPolicy as SandboxPolicy,
        onWarning: (warning) => options.logger?.warn("memory memorian sandbox degraded", {
          identity: identity.identity,
          warning,
        }),
      }),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
    })
    memorianRunners.set(identity.identity, runner)
    return runner
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
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(liveSession === undefined
        ? {}
        : {
            liveSession: () => {
              const live = liveSession()
              if (live === undefined || hooks.onLiveCompletion === undefined) return live
              return {
                ...live,
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
          const result = await runtime.store.evaluate(conversationId, event)
          if (result?.status === "active") {
            runtime.launch(result.run)
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
    memorianRunnerFor,
    runtimeFor,
    triggerSessionFor,
    dreamSessionById,
    dreamSessionFor,
  }
}
