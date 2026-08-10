import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"
import { resolveMemoryIdentity } from "@oh-my-opencode/memory-core"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig, type SenpiOmoConfigResult } from "../config-resolution"
import {
  MEMORY_BINDING_CUSTOM_TYPE,
  createMemoryBinding,
  findLatestMemoryBinding,
  type SessionEntryLike,
} from "./binding"
import { renderMemoryBindingEntry } from "./bindings/entry-renderer"
import { hasMemoryCapabilities, missingMemoryCapabilities } from "./capabilities"
import { createMemoryIdentityContext, type MemoryIdentityContext } from "./context"
import { memoryModuleSupervisor } from "./supervisor"
import { createMemoryWiring, type MemoryWiringOptions } from "./wiring"

const GLOBAL_DISABLED_FLAG = "omo-senpi-disabled"
const MEMORY_DISABLED_FLAG = "omo-senpi-memory-disabled"
const CONFIG_WATCH_RELOADED = "config-watch:reloaded"
const RESTART_REQUIRED_NOTICE = "restart required to apply memory config change"

const DEFAULT_MEMORY_CONFIG: OmoMemorySettings = {
  enabled: true,
  agent: "auto",
  tool_exposure: "direct",
  reflection: {
    trigger: { step_count: 0, on_compaction: true },
    merge: "auto",
    category: "quick",
    timeout_minutes: 15,
    sandbox: "auto",
  },
  sync: { enabled: true },
  search: { enabled: true },
  compile_warn_tokens: 30000,
  agents: {},
}

export type ResolvedMemoryConfig = OmoMemorySettings

export interface MemoryComponentOptions {
  readonly env?: Record<string, string | undefined>
  readonly loadConfig?: (options?: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly now?: () => number
  readonly resolveCwd?: () => string
  readonly createRuntime?: MemoryWiringOptions["createRuntime"]
  readonly refreshStatus?: MemoryWiringOptions["refreshStatus"]
}

type SessionUi = { notify(message: string, level: "error" | "warning"): void }
type SessionSurface = {
  readonly entries: readonly SessionEntryLike[]
  readonly id: string
  readonly ui?: SessionUi
}
type SessionState = {
  readonly enabled: boolean
  readonly ui?: SessionUi
  context?: MemoryIdentityContext
  memoryStatusAttempted: boolean
  restartNotified: boolean
}

export { MEMORY_BINDING_CUSTOM_TYPE } from "./binding"
export { ensureIdentityRuntimeDirs, getMemoryRepo } from "./context"
export type { MemoryIdentityContext, MemoryPendingLedger, MemoryRepoAccess } from "./context"
export { memoryModuleSupervisor } from "./supervisor"

export function createMemoryComponent(options: MemoryComponentOptions = {}): OmoSenpiComponent {
  const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const now = options.now ?? Date.now
  const env = options.env ?? process.env
  const sessions = new Map<string, SessionState>()

  return {
    name: "memory",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const cwd = resolveCwd()
      const bootConfig = resolveMemoryConfig(loadConfig({ cwd }))
      if (!isEnabled(bootConfig, ctx)) return

      const missing = missingMemoryCapabilities(pi)
      if (missing.length > 0 || !hasMemoryCapabilities(pi)) {
        ctx.logger.warn("omo-senpi memory component skipped: missing ExtensionAPI capabilities", { missing })
        return
      }

      const wiring = createMemoryWiring({
        sessions,
        loadConfig,
        cwd: resolveCwd,
        env,
        now,
        logger: ctx.logger,
        ...(options.createRuntime === undefined ? {} : { createRuntime: options.createRuntime }),
        ...(options.refreshStatus === undefined ? {} : { refreshStatus: options.refreshStatus }),
        // Reuse the boot snapshot: registration must not add a loadConfig() call, because the
        // enablement latch depends on the ORDER of reads across boot -> session_start -> reload.
        toolExposure: bootConfig.tool_exposure,
      })
      wiring.registerStatic(pi, ctx)
      pi.registerEntryRenderer(MEMORY_BINDING_CUSTOM_TYPE, renderMemoryBindingEntry)
      const unsubscribeReload = pi.events?.on(CONFIG_WATCH_RELOADED, (payload) => {
        if (!isOmoConfigReload(payload)) return
        const enabled = isEnabled(resolveMemoryConfig(loadConfig({ cwd })), ctx)
        for (const state of sessions.values()) {
          if (state.enabled === enabled || state.restartNotified) continue
          state.restartNotified = true
          state.ui?.notify(RESTART_REQUIRED_NOTICE, "warning")
        }
      })

      pi.on("session_start", (_payload, eventCtx) => {
        const surface = readSessionSurface(eventCtx)
        wiring.clearStatus(eventCtx)
        const sessionConfig = resolveMemoryConfig(loadConfig({ cwd }))
        const enabled = isEnabled(sessionConfig, ctx)
        releaseSession(sessions.get(surface.id))
        const state: SessionState = {
          enabled,
          memoryStatusAttempted: false,
          restartNotified: false,
          ...(surface.ui === undefined ? {} : { ui: surface.ui }),
        }
        sessions.set(surface.id, state)
        if (!enabled) return

        const identity = resolveMemoryIdentity(sessionConfig.agent, cwd, env)
        const previous = findLatestMemoryBinding(surface.entries)
        if (previous !== undefined && previous.identity !== identity.id) {
          surface.ui?.notify(
            `memory identity conflict: session is bound to ${previous.identity}, but config resolved ${identity.id}; restart with the original identity or fork a new session`,
            "error",
          )
          return
        }

        const binding = createMemoryBinding({ identity: identity.id, repoPath: identity.paths.repo, boundAt: now() })
        state.context = createMemoryIdentityContext({
          identity: identity.id,
          identityPaths: identity.paths,
          binding,
        })
        memoryModuleSupervisor.acquire()
        pi.appendEntry(MEMORY_BINDING_CUSTOM_TYPE, binding)
        void wiring.afterBind(pi, surface.id, state.context, eventCtx)
      })

      pi.on("session_shutdown", (_payload, eventCtx) => {
        const sessionId = readSessionSurface(eventCtx).id
        wiring.clearStatus(eventCtx)
        releaseSession(sessions.get(sessionId))
        sessions.delete(sessionId)
        unsubscribeReload?.()
      })
    },
  }
}

export function resolveMemoryConfig(loaded: SenpiOmoConfigResult): ResolvedMemoryConfig {
  return loaded.config.memory ?? DEFAULT_MEMORY_CONFIG
}

function isEnabled(config: ResolvedMemoryConfig, ctx: ComponentContext): boolean {
  return config.enabled
    && ctx.config.getFlag(GLOBAL_DISABLED_FLAG) !== true
    && ctx.config.getFlag(MEMORY_DISABLED_FLAG) !== true
}

function releaseSession(state: SessionState | undefined): void {
  if (state?.context === undefined) return
  memoryModuleSupervisor.release()
  state.context = undefined
}

function readSessionSurface(value: unknown): SessionSurface {
  if (!isRecord(value)) return { entries: [], id: "unknown-session" }
  const manager = isRecord(value.sessionManager) ? value.sessionManager : undefined
  const getSessionId = manager?.getSessionId
  const getEntries = manager?.getEntries
  const id = typeof getSessionId === "function" ? Reflect.apply(getSessionId, manager, []) : "unknown-session"
  const entries = typeof getEntries === "function" ? Reflect.apply(getEntries, manager, []) : []
  const ui = isSessionUi(value.ui) ? value.ui : undefined
  return {
    entries: Array.isArray(entries) ? entries : [],
    id: typeof id === "string" && id.length > 0 ? id : "unknown-session",
    ...(ui === undefined ? {} : { ui }),
  }
}

function isSessionUi(value: unknown): value is SessionUi {
  return isRecord(value) && typeof value.notify === "function"
}

function isOmoConfigReload(value: unknown): boolean {
  return isRecord(value) && value.registrationId === "omo"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
