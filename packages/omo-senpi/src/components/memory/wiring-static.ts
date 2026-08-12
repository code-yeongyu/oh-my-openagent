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
import type { createSoulNoticeWiring } from "./soul-notice"
import { createReflectionTriggerWiring } from "./trigger-wiring"
import { MEMORY_APPLY_PATCH_TOOL_NAME, MEMORY_TOOL_NAME, registerMemoryToolSurface } from "./tools"
import { refreshMemoryStatus } from "./status"
import { registerReflectionCompletionRenderer, type ReflectionCompletionApi } from "./worker"
import { branchEntryCount, isRecord, readUi, sessionIdFrom } from "./wiring-context"
import type { MemoryWiringOptions } from "./wiring-types"
import type { MemoryIdentityContext } from "./context"
import { createMemoryPromptHandler as createPromptHandler } from "./prompt"

export function registerMemoryStatic(input: {
  readonly pi: SenpiExtensionAPI
  readonly ctx: ComponentContext
  readonly options: MemoryWiringOptions
  readonly promptCache: MemoryBlockCache
  readonly nudgeWiring: ReturnType<typeof createMemoryNudgeWiring>
  readonly soulNoticeWiring: ReturnType<typeof createSoulNoticeWiring>
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
  /** Fires at the manual reflection launch site so the footer animates while the run is in flight. */
  readonly onReflectionLaunch?: (identity: string, run: ReservedRun) => void | Promise<void>
  /** Fires after each settle so the footer can refresh its segments behind the fingerprint gate. */
  readonly onSettled?: (sessionId: string, eventCtx: unknown) => void | Promise<void>
  /** Fires after every successful memory write, independent of the once-only footer latch. */
  readonly onMemoryWrite?: (sessionId: string) => void | Promise<void>
}): void {
  const {
    pi, ctx, options, promptCache, nudgeWiring, soulNoticeWiring, dreamTriggerWiring,
    completionApi, resolveContext, journalWiringFor, factsWiringFor, runtimeFor,
    triggerSessionFor, resolvePalacePeople, loadCommandSettings, lastEventCtx,
    activeSession, skillsUsageTrackersRef, onReflectionLaunch, onSettled, onMemoryWrite,
  } = input
  const api = completionApi(pi)
  if (api !== undefined) registerReflectionCompletionRenderer(api)
  if (hasMemoryCapabilities(pi)) {
    nudgeWiring.register(pi)
    soulNoticeWiring.register(pi)
  }
  const toolExposure = options.toolExposure ?? "direct"
  const promptHandler = createPromptHandler({
    resolveContext,
    cache: promptCache,
    searchExposure: () => toolExposure === "search",
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
  // Status footer after a successful memory write: shown at most once per session, gated on the
  // session state flag so a burst of memory tool results does not repaint the footer repeatedly.
  const refreshStatus = options.refreshStatus ?? refreshMemoryStatus
  pi.on("tool_result", async (payload: unknown, eventCtx: unknown) => {
    if (!isMemoryToolResult(payload)) return
    const sessionId = sessionIdFrom(eventCtx)
    if (sessionId === undefined) return
    const state = options.sessions.get(sessionId)
    if (state?.context === undefined) return
    // The rpc snapshot follows every successful write; only the footer honors the once-only latch.
    await onMemoryWrite?.(sessionId)
    if (state.memoryStatusAttempted === true) return
    const ui = readUi(eventCtx)
    if (ui === undefined) return
    state.memoryStatusAttempted = true
    const settings = options.loadConfig({ cwd: options.cwd() }).config.memory
    try {
      const result = await refreshStatus({
        context: state.context,
        ui,
        compileWarnTokens: settings?.compile_warn_tokens ?? 30_000,
        alreadyNotified: false,
        checkAdvisory: false,
        sessionId,
        ...(options.now === undefined ? {} : { now: options.now }),
      })
      state.memoryStatusAttempted = result.footerShown
    } catch (error) {
      state.memoryStatusAttempted = false
      throw error
    }
  })
  registerMemoryToolSurface(pi, () => (activeSession.current === undefined ? undefined : resolveContext(activeSession.current)), {
    exposure: toolExposure,
    onCommit: (commit) => {
      const context = activeSession.current === undefined ? undefined : resolveContext(activeSession.current)
      if (context !== undefined) soulNoticeWiring.onCommit(context, commit)
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

function asCommandIdentity(identity: MemoryIdentityContext | undefined): MemoryCommandIdentity | undefined {
  if (identity === undefined) return undefined
  return { identity: identity.identity, identityPaths: identity.identityPaths }
}

function isMemoryToolResult(value: unknown): boolean {
  if (
    !isRecord(value)
    || value.type !== "tool_result"
    || value.isError === true
    || typeof value.toolName !== "string"
  ) return false
  return matchesToolName(value.toolName, MEMORY_TOOL_NAME)
    || matchesToolName(value.toolName, MEMORY_APPLY_PATCH_TOOL_NAME)
}

function matchesToolName(toolName: string, expected: string): boolean {
  const normalized = toolName.trim().toLowerCase().replaceAll("-", "_")
  const target = expected.trim().toLowerCase().replaceAll("-", "_")
  return normalized === target || normalized.endsWith(`_${target}`)
}
