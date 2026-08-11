import { homedir } from "node:os"
import { join } from "node:path"

import { MemoryBlockCache } from "@oh-my-opencode/memory-core"

import type { ComponentContext, ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import { hasMemoryCapabilities } from "./capabilities"
import type { MemoryIdentityContext } from "./context"
import {
  createIdentityRuntime,
  type MemoryIdentityRuntime,
  type MemoryIdentityRuntimeDeps,
} from "./identity-runtime"
import { createMemoryJournalWiring, type MemoryJournalWiring } from "./journal-wiring"
import { resolveMemoryModelRegistry } from "./model-registry-resolver"
import { registerPalaceCommand } from "./palace/command"
import { createMemoryPromptHandler } from "./prompt"
import { registerMemoryCommands } from "./commands/register"
import type { MemoryCommandIdentity, MemoryCommandSettings } from "./commands/types"
import { registerMemoryGuard } from "./guard"
import { registerMemoryFilesystemPolicy } from "./policy-guard"
import { MEMORY_STATUS_KEY, refreshMemoryStatus } from "./status"
import { registerMemorySkillsScope } from "./skills-scope"
import { createReflectionTriggerWiring, type ReflectionTriggerSession } from "./trigger-wiring"
import {
  MEMORY_APPLY_PATCH_TOOL_NAME,
  MEMORY_TOOL_NAME,
  registerMemoryToolSurface,
} from "./tools"
import {
  consumePendingReflectionCompletions,
  registerReflectionCompletionRenderer,
  type ReflectionCompletionApi,
} from "./worker"

export interface MemorySessionStateLike {
  readonly context?: MemoryIdentityContext
  memoryStatusAttempted: boolean
}

export interface MemoryWiringOptions {
  readonly sessions: Map<string, MemorySessionStateLike>
  readonly loadConfig: (options: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly cwd: () => string
  readonly env: Record<string, string | undefined>
  readonly now?: () => number
  readonly logger?: ComponentLogger
  readonly refreshStatus?: typeof refreshMemoryStatus
  readonly createRuntime?: (
    identity: MemoryIdentityContext,
    deps: MemoryIdentityRuntimeDeps,
  ) => Pick<MemoryIdentityRuntime, "store" | "launch">
  /** Boot-snapshot tool exposure; registration must not re-read config (latch order is observable). */
  readonly toolExposure?: "direct" | "search"
}

export interface MemoryWiring {
  registerStatic(pi: SenpiExtensionAPI, ctx: ComponentContext): void
  clearStatus(eventCtx: unknown): void
  afterBind(pi: SenpiExtensionAPI, sessionId: string, identity: MemoryIdentityContext, eventCtx: unknown): Promise<void>
}

type StatusUi = {
  setStatus(key: string, text?: string): void
  notify(message: string, level: "info" | "warning" | "error"): void
}

export function createMemoryWiring(options: MemoryWiringOptions): MemoryWiring {
  const promptCache = new MemoryBlockCache()
  const refreshStatus = options.refreshStatus ?? refreshMemoryStatus
  const runtimes = new Map<string, Pick<MemoryIdentityRuntime, "store" | "launch">>()
  const journals = new Map<string, MemoryJournalWiring>()
  const lastEventCtx: { current?: unknown } = {}
  let activeSessionId: string | undefined

  const resolveContext = (sessionId: string): MemoryIdentityContext | undefined =>
    options.sessions.get(sessionId)?.context

  function asCommandIdentity(identity: MemoryIdentityContext | undefined): MemoryCommandIdentity | undefined {
    if (identity === undefined) return undefined
    return { identity: identity.identity, identityPaths: identity.identityPaths }
  }

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

  function journalWiringFor(identity: MemoryIdentityContext): MemoryJournalWiring {
    const cached = journals.get(identity.identity)
    if (cached !== undefined) return cached
    const wiring = createMemoryJournalWiring({ identityPaths: identity.identityPaths })
    journals.set(identity.identity, wiring)
    return wiring
  }

  function runtimeFor(identity: MemoryIdentityContext): Pick<MemoryIdentityRuntime, "store" | "launch"> {
    const cached = runtimes.get(identity.identity)
    if (cached !== undefined) return cached
    const create = options.createRuntime ?? createIdentityRuntime
    const runtime = create(identity, {
      loadConfig: options.loadConfig,
      cwd: options.cwd,
      resolveModelRegistry: () => resolveMemoryModelRegistry(lastEventCtx.current),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
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
    return {
      conversationId: sessionId,
      ledger: identity.ledger,
      engine: {
        evaluate: async (conversationId, event) => {
          lastEventCtx.current = eventCtx
          const result = await runtime.store.evaluate(conversationId, event)
          if (result?.status === "active") runtime.launch(result.run)
          return result
        },
      },
    }
  }

  function sessionIdFrom(eventCtx: unknown): string | undefined {
    if (!isRecord(eventCtx)) return undefined
    const manager = isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
    const getter = manager?.getSessionId
    if (typeof getter !== "function") return undefined
    const id = Reflect.apply(getter, manager, [])
    return typeof id === "string" && id.length > 0 ? id : undefined
  }

  function branchEntryCount(eventCtx: unknown): number {
    if (!isRecord(eventCtx)) return 0
    const manager = isRecord(eventCtx.sessionManager) ? eventCtx.sessionManager : undefined
    const getEntries = manager?.getEntries
    if (typeof getEntries !== "function") return 0
    const entries = Reflect.apply(getEntries, manager, [])
    return Array.isArray(entries) ? entries.length : 0
  }

  function readUi(eventCtx: unknown): StatusUi | undefined {
    if (!isRecord(eventCtx)) return undefined
    const ui = eventCtx.ui
    if (!isRecord(ui)) return undefined
    if (typeof ui.setStatus !== "function" || typeof ui.notify !== "function") return undefined
    return {
      setStatus: (key, text) => Reflect.apply(ui.setStatus as (...args: unknown[]) => unknown, ui, [key, text]),
      notify: (message, level) => Reflect.apply(ui.notify as (...args: unknown[]) => unknown, ui, [message, level]),
    }
  }

  function loadCommandSettings(): MemoryCommandSettings {
    const settings = options.loadConfig({ cwd: options.cwd() }).config.memory
    if (settings === undefined) throw new Error("memory settings unavailable")
    return { settings }
  }

  return {
    registerStatic(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const api = completionApi(pi)
      if (api !== undefined) registerReflectionCompletionRenderer(api)
      const toolExposure = options.toolExposure ?? "direct"
      const promptHandler = createMemoryPromptHandler({
        resolveContext,
        cache: promptCache,
        searchExposure: () => toolExposure === "search",
      })
      pi.on("before_agent_start", (payload, eventCtx) => {
        lastEventCtx.current = eventCtx
        return promptHandler(payload, eventCtx)
      })
      pi.on("session_start", (_payload, eventCtx) => {
        if (eventCtx !== undefined) lastEventCtx.current = eventCtx
      })
      pi.on("agent_settled", (_payload, eventCtx) => {
        lastEventCtx.current = eventCtx
        const sessionId = sessionIdFrom(eventCtx)
        if (sessionId === undefined) return undefined
        const identity = resolveContext(sessionId)
        if (identity === undefined) return undefined
        activeSessionId = sessionId
        if (branchEntryCount(eventCtx) === 0) return undefined
        return journalWiringFor(identity).reconcileSession(eventCtx)
      })
      pi.on("tool_result", async (payload, eventCtx) => {
        if (!isMemoryToolResult(payload)) return
        const sessionId = sessionIdFrom(eventCtx)
        if (sessionId === undefined) return
        const state = options.sessions.get(sessionId)
        if (state?.context === undefined || state.memoryStatusAttempted) return
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
            ...(options.now === undefined ? {} : { now: options.now }),
          })
          state.memoryStatusAttempted = result.footerShown
        } catch (error) {
          state.memoryStatusAttempted = false
          throw error
        }
      })
      registerMemoryToolSurface(pi, () => (activeSessionId === undefined ? undefined : resolveContext(activeSessionId)), {
        exposure: toolExposure,
      })
      registerMemoryGuard(pi, ctx, {
        getContext: (eventContext) => {
          const sessionId = sessionIdFrom(eventContext)
          return sessionId === undefined ? undefined : resolveContext(sessionId)
        },
        resolveCwd: options.cwd,
      })
      registerMemorySkillsScope(pi, { resolveContext })
      registerPalaceCommand(pi, () => (activeSessionId === undefined ? undefined : resolveContext(activeSessionId)))
      registerMemoryCommands(pi, {
        contextForSession: (sessionId) => asCommandIdentity(resolveContext(sessionId)),
        resolveIdentity: () => (activeSessionId === undefined ? undefined : asCommandIdentity(resolveContext(activeSessionId))),
        loadSettings: loadCommandSettings,
        bustPromptCache: () => promptCache.clear(),
        reflectionSink: {
          request: async (request) => {
            if (activeSessionId === undefined) throw new Error("no bound memory session")
            const identity = resolveContext(activeSessionId)
            if (identity === undefined) throw new Error("no bound memory session")
            const runtime = runtimeFor(identity)
            const result = await runtime.store.evaluate(activeSessionId, {
              kind: "manual",
              ...(request.focus === undefined ? {} : { focus: request.focus }),
              ...(request.recentN === undefined ? {} : { recentN: request.recentN }),
              ...(request.conversationIds === undefined ? {} : { conversationIds: request.conversationIds }),
            })
            if (result === null) throw new Error("reflection reservation rejected")
            if (result.status === "active") runtime.launch(result.run)
            return { disposition: result.status === "active" ? "reserved" : "pending", runId: result.run.runId }
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
    },

    clearStatus(eventCtx: unknown): void {
      readUi(eventCtx)?.setStatus(MEMORY_STATUS_KEY, undefined)
    },

    async afterBind(pi: SenpiExtensionAPI, sessionId: string, identity: MemoryIdentityContext, eventCtx: unknown): Promise<void> {
      activeSessionId = sessionId
      lastEventCtx.current = eventCtx
      registerMemoryFilesystemPolicy(pi, identity)
      if (branchEntryCount(eventCtx) > 0) {
        await journalWiringFor(identity).reconcileSession(eventCtx)
      }
      const ui = readUi(eventCtx)
      if (ui !== undefined) {
        const settings = options.loadConfig({ cwd: options.cwd() }).config.memory
        void refreshStatus({
          context: identity,
          ui,
          compileWarnTokens: settings?.compile_warn_tokens ?? 30_000,
          alreadyNotified: false,
          showFooter: false,
        }).catch(() => {})
      }
      const api = completionApi(pi)
      if (api !== undefined) {
        void consumePendingReflectionCompletions(
          join(identity.identityPaths.reflection, "completions"),
          { sessionId, api },
        ).catch(() => {})
      }
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
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
  const suffix = expected.trim().toLowerCase().replaceAll("-", "_")
  return normalized === suffix
    || normalized.endsWith(`_${suffix}`)
    || normalized.endsWith(`:${suffix}`)
    || normalized.endsWith(`/${suffix}`)
}
