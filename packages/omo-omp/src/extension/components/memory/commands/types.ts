// Shared seams for the memory slash-command suite.
//
// Handlers receive senpi's ExtensionCommandContext structurally (only the fields
// the suite reads) and return the rendered text; every user-visible line is ALSO
// pushed through ctx.ui.notify so read-only output never enters model context.

import type { GitExec, MemoryIdentityPaths } from "@oh-my-opencode/memory-core"
import type { OmoMemorySettings } from "@oh-my-opencode/omo-config-core"

export type NotifyLevel = "info" | "warning" | "error"

export interface MemoryCommandUi {
  notify(message: string, level?: NotifyLevel): void
  confirm?(title: string, message: string): Promise<boolean>
  select?(title: string, options: string[]): Promise<string | undefined>
}

/** Structural slice of senpi's ExtensionCommandContext the memory commands read. */
export interface MemoryCommandContext {
  readonly mode?: string
  readonly hasUI?: boolean
  readonly cwd?: string
  readonly agentDir?: string
  readonly ui?: MemoryCommandUi
  readonly sessionManager?: { getSessionId(): string }
  waitForIdle?(): Promise<void>
}

export type MemoryCommandHandler = (args: string, ctx: MemoryCommandContext) => Promise<string>

export interface MemoryCommandIdentity {
  readonly identity: string
  readonly identityPaths: MemoryIdentityPaths
}

/** P22 trigger-wiring seam: a manual `/reflect` request the scheduler reserves or queues. */
export interface ManualReflectionRequest {
  readonly focus?: string
  readonly recentN?: number
  readonly conversationIds?: readonly string[]
}

export interface ReflectionRequestReceipt {
  readonly disposition: "reserved" | "pending"
  readonly runId: string
}

export interface ReflectionRequestSink {
  request(request: ManualReflectionRequest): Promise<ReflectionRequestReceipt>
}

export interface MemoryCommandSettings {
  readonly settings: OmoMemorySettings
  /** Path of the omo config file users edit to change memory settings. */
  readonly configPath?: string
}

export interface MemoryCommandDeps {
  /** Bound identity for a session; undefined when the session has no memory binding. */
  contextForSession(sessionId: string): MemoryCommandIdentity | undefined
  /** Config-resolved identity for `/memfs init`, which may run before any binding exists. */
  resolveIdentity?(): MemoryCommandIdentity | undefined
  loadSettings(): MemoryCommandSettings
  /** Prompt-assembly cache seam: busting makes the next agent run recompile from HEAD. */
  bustPromptCache(): void
  reflectionSink?: ReflectionRequestSink
  /** Senpi sessions root for `/search`; defaults to <agentDir>/sessions. */
  sessionsDir?(): string
  exec?: GitExec
  now?(): number
  /** Doctor stale-lock liveness probe; defaults to signal-0. */
  isProcessAlive?(pid: number): boolean
}

/** Notify (when a UI is present) and return the same text for headless consumers. */
export function respond(ctx: MemoryCommandContext, text: string, level: NotifyLevel = "info"): string {
  ctx.ui?.notify(text, level)
  return text
}

export function sessionIdOf(ctx: MemoryCommandContext): string | undefined {
  return ctx.sessionManager?.getSessionId()
}

/** Bound identity required by most handlers; undefined yields an actionable error text. */
export function identityFor(deps: MemoryCommandDeps, ctx: MemoryCommandContext): MemoryCommandIdentity | undefined {
  const sessionId = sessionIdOf(ctx)
  if (sessionId === undefined) return undefined
  return deps.contextForSession(sessionId)
}

/** `/memfs init` fallback: bound identity first, then the config-resolved identity. */
export function identityForInit(deps: MemoryCommandDeps, ctx: MemoryCommandContext): MemoryCommandIdentity | undefined {
  return identityFor(deps, ctx) ?? deps.resolveIdentity?.()
}

export function requireIdentity(
  deps: MemoryCommandDeps,
  ctx: MemoryCommandContext,
): MemoryCommandIdentity | string {
  const identity = identityFor(deps, ctx)
  if (identity !== undefined) return identity
  return "memory is not bound to this session; start a session with memory enabled and retry"
}

/** Interactive = dialog-capable UI (senpi hasUI); noninteractive handlers require --force. */
export function isInteractive(ctx: MemoryCommandContext): boolean {
  return ctx.hasUI === true && typeof ctx.ui?.confirm === "function"
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
