import type { ComponentContext, ComponentLogger, SenpiExtensionAPI } from "../../extension/types"
import type { SenpiOmoConfigResult } from "../config-resolution"
import type { MemoryIdentityContext } from "./context"
import type { FactsExtractorRunnerOptions } from "./facts-runner"
import type { FactsExtractorPort } from "./facts-wiring"
import type { MemoryIdentityRuntime, MemoryIdentityRuntimeDeps } from "./identity-runtime"
import type { MemorianGatePort } from "./memorian-wiring"
import type { ShutdownDrainInput, ShutdownEvaluator } from "./shutdown-drain"
import type { refreshMemoryStatus } from "./status"
import type { MemoryFooterTimers } from "./status-live"

export interface MemorySessionStateLike {
  readonly context?: MemoryIdentityContext
  /** Set once the status footer has been attempted for this session, so it shows at most once. */
  memoryStatusAttempted?: boolean
}

export interface MemoryWiringOptions {
  readonly sessions: Map<string, MemorySessionStateLike>
  readonly loadConfig: (options: { readonly cwd?: string }) => SenpiOmoConfigResult
  readonly cwd: () => string
  readonly env: Record<string, string | undefined>
  readonly logger?: ComponentLogger
  readonly createRuntime?: (identity: MemoryIdentityContext, deps: MemoryIdentityRuntimeDeps) => MemoryIdentityRuntime
  readonly createFactsExtractor?: (options: FactsExtractorRunnerOptions) => FactsExtractorPort
  /** Memorian gate runner seam; the live QA driver substitutes a scripted child here. */
  readonly createMemorianRunner?: (identity: MemoryIdentityContext) => MemorianGatePort
  /** Boot-snapshot tool exposure; registration must not re-read config (latch order is observable). */
  readonly toolExposure?: "direct" | "search"
  readonly now?: () => number
  readonly refreshStatus?: typeof refreshMemoryStatus
  /** Injectable animation timers; tests drive frames without touching the wall clock. */
  readonly footerTimers?: MemoryFooterTimers
}

export interface MemoryWiring {
  registerStatic(pi: SenpiExtensionAPI, ctx: ComponentContext): void
  afterBind(pi: SenpiExtensionAPI, sessionId: string, identity: MemoryIdentityContext, eventCtx: unknown): Promise<void>
  flushSkillsUsage(): Promise<void>
  /** IC-10: bounded drain the session_shutdown handler awaits before the session is released. */
  onSessionShutdown(input: ShutdownDrainInput): Promise<void>
  /** IC-10: appends an evaluator run last on quit; unregistered is a no-op. */
  registerShutdownEvaluator(evaluator: ShutdownEvaluator): void
  /** Clears the memory status footer for the session behind this event context. */
  clearStatus(eventCtx: unknown): void
}

export type StatusUi = {
  setStatus(key: string, text?: string): void
  notify(message: string, level: "info" | "warning" | "error"): void
}
