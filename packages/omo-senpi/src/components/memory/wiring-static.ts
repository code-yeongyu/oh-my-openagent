import { homedir } from "node:os"
import { join } from "node:path"

import { consumeSoulNoticeDelta, type MemoryBlockCache, type ReservedRun } from "@oh-my-opencode/memory-core"

import type { ComponentContext, SenpiExtensionAPI } from "../../extension/types"
import { hasMemoryCapabilities } from "./capabilities"
import { registerMemoryCommands } from "./commands/register"
import type { MemoryCommandIdentity, MemoryCommandSettings } from "./commands/types"
import type { DreamTriggerWiring } from "./dream-trigger"
import type { MemoryFactsWiring } from "./facts-wiring"
import { registerMemoryGuard } from "./guard"
import type { MemoryIdentityRuntime } from "./identity-runtime"
import type { MemoryJournalWiring } from "./journal-wiring"
import type { createMemoryNudgeWiring } from "./nudge-wiring"
import { registerPalaceCommand } from "./palace/command"
import { registerMemorySkillsScope } from "./skills-scope"
import { registerSkillsUsage, type SkillsUsageTracker } from "./skills-usage"
import { registerMemoryUsage, type MemoryUsageTracker } from "./memory-usage"
import type { createMemoryNoticeWiring } from "./memory-notice-wiring"
import { createReflectionTriggerWiring } from "./trigger-wiring"
import { registerMemoryToolSurface } from "./tools"
import {
  registerReflectionCompletionRenderer,
  registerReflectionHealthRenderer,
  type ReflectionCompletionApi,
} from "./worker"
import { branchEntryCount, sessionIdFrom } from "./wiring-context"
import { registerMemoryWriteListener } from "./wiring-memory-write"
import type { MemoryWiringOptions } from "./wiring-types"
import type { MemoryIdentityContext } from "./context"
import { createMemoryPromptHandler as createPromptHandler } from "./prompt"

export function registerMemoryStatic(input: {
  readonly pi: SenpiExtensionAPI
  readonly ctx: ComponentContext
  readonly options: MemoryWiringOptions
  readonly promptCache: MemoryBlockCache
  readonly nudgeWiring: ReturnType<typeof createMemoryNudgeWiring>
  readonly noticeWiring: ReturnType<typeof createMemoryNoticeWiring>
  readonly dreamTriggerWiring: DreamTriggerWiring
  readonly completionApi: (pi: SenpiExtensionAPI) => ReflectionCompletionApi | undefined
  readonly resolveContext: (sessionId: string) => MemoryIdentityContext | undefined
  readonly journalWiringFor: (identity: MemoryIdentityContext) => MemoryJournalWiring
  readonly factsWiringFor: (identity: MemoryIdentityContext) => MemoryFactsWiring
  readonly runtimeFor: (identity: MemoryIdentityContext) => MemoryIdentityRuntime
  readonly triggerSessionFor: Parameters<typeof createReflectionTriggerWiring>[0]["resolveSession"]
  readonly resolvePalacePeople: Parameters<typeof registerPalaceCommand>[2]
  readonly loadCommandSettings: () => MemoryCommandSettings
  readonly lastEventCtx: { current?: unknown }
  readonly activeSession: { current?: string }
  readonly skillsUsageTrackersRef: { current: Map<string, SkillsUsageTracker> }
  readonly memoryUsageTrackersRef: { current: Map<string, MemoryUsageTracker> }
  /** Fires at the manual reflection launch site so the footer animates while the run is in flight. */
  readonly onReflectionLaunch?: (identity: string, run: ReservedRun) => void | Promise<void>
  /** Fires after each settle so the footer can refresh its segments behind the fingerprint gate. */
  readonly onSettled?: (sessionId: string, eventCtx: unknown) => void | Promise<void>
  /** Fires after every successful memory write, independent of the once-only footer latch. */
  readonly onMemoryWrite?: (sessionId: string) => void | Promise<void>
}): void {
  const {
    pi, ctx, options, promptCache, nudgeWiring, noticeWiring, dreamTriggerWiring,
    completionApi, resolveContext, journalWiringFor, factsWiringFor, runtimeFor,
    triggerSessionFor, resolvePalacePeople, loadCommandSettings, lastEventCtx,
    activeSession, skillsUsageTrackersRef, memoryUsageTrackersRef, onReflectionLaunch, onSettled, onMemoryWrite,
  } = input
  const api = completionApi(pi)
  if (api !== undefined) {
    registerReflectionCompletionRenderer(api)
    registerReflectionHealthRenderer(api)
  }
  if (hasMemoryCapabilities(pi)) {
    nudgeWiring.register(pi)
    noticeWiring.register(pi)
  }
  const toolExposure = options.toolExposure ?? "direct"
  const promptHandler = createPromptHandler({
    resolveContext,
    cache: promptCache,
    searchExposure: () => toolExposure === "search",
    resolveCompileWarnTokens: () => loadCommandSettings().settings.compile_warn_tokens,
    resolveNudgeTurns: (repo, sessionId, identity) => nudgeWiring.nudgeTurns(repo, sessionId, identity),
    resolveSoulNotice: async (repo, sessionId, identity) => {
      const context = resolveContext(sessionId)
      if (context === undefined || context.identity !== identity) return undefined
      return consumeSoulNoticeDelta(repo, {
        noticesDir: context.identityPaths.notices,
        locksDir: context.identityPaths.locks,
      })
    },
  })
  pi.on("before_agent_start", (payload, eventCtx) => {
    lastEventCtx.current = eventCtx
    return promptHandler(payload, eventCtx)
  })
  pi.on("session_start", (_payload, eventCtx) => {
    if (eventCtx !== undefined) lastEventCtx.current = eventCtx
  })
  pi.on("agent_settled", async (_payload, eventCtx) => {
    lastEventCtx.current = eventCtx
    const sessionId = sessionIdFrom(eventCtx)
    if (sessionId === undefined) return undefined
    const identity = resolveContext(sessionId)
    if (identity === undefined) return undefined
    activeSession.current = sessionId
    if (branchEntryCount(eventCtx) === 0) {
      await onSettled?.(sessionId, eventCtx)
      return undefined
    }
    const result = await journalWiringFor(identity).reconcileSession(eventCtx)
    await factsWiringFor(identity).onSettled(sessionId)
    await onSettled?.(sessionId, eventCtx)
    return result
  })
  registerMemoryWriteListener(pi, options, onMemoryWrite)
  registerMemoryToolSurface(pi, () => (activeSession.current === undefined ? undefined : resolveContext(activeSession.current)), {
    exposure: toolExposure,
    onCommit: (commit) => {
      const context = activeSession.current === undefined ? undefined : resolveContext(activeSession.current)
      if (context !== undefined) noticeWiring.onCommit(context, commit)
    },
    // Read per call rather than latched at registration: the gate is presentation-only, so a
    // config edit takes effect on the next write instead of at the next restart.
    writeNotice: {
      get enabled(): boolean {
        return resolveWriteNoticeEnabled(loadCommandSettings, activeSession, resolveContext)
      },
      resolveSessionId: () => activeSession.current,
    },
  })
  registerMemoryGuard(pi, ctx, {
    getContext: (eventContext) => {
      const sessionId = sessionIdFrom(eventContext)
      return sessionId === undefined ? undefined : resolveContext(sessionId)
    },
    resolveCwd: options.cwd,
  })
  registerMemorySkillsScope(pi, { resolveContext })
  const skillsUsageTrackers = registerSkillsUsage(pi, {
    resolveContext: (eventContext) => {
      const sessionId = sessionIdFrom(eventContext)
      return sessionId === undefined ? undefined : resolveContext(sessionId)
    },
    resolveCwd: options.cwd,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  skillsUsageTrackersRef.current = skillsUsageTrackers
  const memoryUsageTrackers = registerMemoryUsage(pi, {
    resolveContext: (eventContext) => {
      const sessionId = sessionIdFrom(eventContext)
      return sessionId === undefined ? undefined : resolveContext(sessionId)
    },
    resolveCwd: options.cwd,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  memoryUsageTrackersRef.current = memoryUsageTrackers
  registerPalaceCommand(
    pi,
    () => (activeSession.current === undefined ? undefined : resolveContext(activeSession.current)),
    resolvePalacePeople,
  )
  registerMemoryCommands(pi, {
    contextForSession: (sessionId) => asCommandIdentity(resolveContext(sessionId)),
    resolveIdentity: () => (activeSession.current === undefined ? undefined : asCommandIdentity(resolveContext(activeSession.current))),
    loadSettings: loadCommandSettings,
    bustPromptCache: () => promptCache.clear(),
    reflectionSink: {
      request: async (request) => {
        if (activeSession.current === undefined) throw new Error("no bound memory session")
        const identity = resolveContext(activeSession.current)
        if (identity === undefined) throw new Error("no bound memory session")
        const runtime = runtimeFor(identity)
        const result = await runtime.store.evaluate(activeSession.current, {
          kind: "manual",
          ...(request.focus === undefined ? {} : { focus: request.focus }),
          ...(request.recentN === undefined ? {} : { recentN: request.recentN }),
          ...(request.conversationIds === undefined ? {} : { conversationIds: request.conversationIds }),
        })
        if (result === null) throw new Error("reflection reservation rejected")
        if (result.status === "active") {
          runtime.launch(result.run)
          await onReflectionLaunch?.(identity.identity, result.run)
        }
        return { disposition: result.status === "active" ? "reserved" : "pending", runId: result.run.runId }
      },
    },
    dreamSink: { request: (request) => dreamTriggerWiring.requestManualDream(request) },
    factsSink: {
      // ONE attempt after a manual unpark: `reconcileExtractor` fires the extractor's own
      // reconcile-then-launch path, which owns the re-entrancy latch, so this never loops.
      reconcile: async () => {
        const identity = activeSession.current === undefined ? undefined : resolveContext(activeSession.current)
        if (identity !== undefined) factsWiringFor(identity).reconcileExtractor()
      },
    },
    sessionsDir: () => join(options.env.SENPI_CODING_AGENT_DIR ?? join(homedir(), ".senpi", "agent"), "sessions"),
  })
  const triggerWiring = createReflectionTriggerWiring({
    resolveSession: triggerSessionFor,
    onLaunch: () => {},
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
  triggerWiring.register(pi)
  dreamTriggerWiring.register(pi)
}

/** memory.write_notice.enabled for the bound identity, honouring its per-agent override. */
function resolveWriteNoticeEnabled(
  loadCommandSettings: () => MemoryCommandSettings,
  activeSession: { current?: string },
  resolveContext: (sessionId: string) => MemoryIdentityContext | undefined,
): boolean {
  try {
    const settings = loadCommandSettings().settings
    const identity = activeSession.current === undefined ? undefined : resolveContext(activeSession.current)?.identity
    const override = identity === undefined ? undefined : settings.agents[identity]?.write_notice
    return override?.enabled ?? settings.write_notice.enabled
  } catch {
    // Presentation must never depend on config health: an unreadable config keeps the default on.
    return true
  }
}

function asCommandIdentity(identity: MemoryIdentityContext | undefined): MemoryCommandIdentity | undefined {
  if (identity === undefined) return undefined
  return { identity: identity.identity, identityPaths: identity.identityPaths }
}
