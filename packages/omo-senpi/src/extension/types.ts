import type { EvalHandleHost, ToolDefinition } from "@code-yeongyu/senpi"

import type { IdleInjectionCoordinator } from "./idle-injection-coordinator"
import type { StartupWork } from "./startup-deferral"

export interface CompactReadClassification {
  readonly kind: "docs" | "resource" | "skill" | "memory"
  readonly label: string
  readonly headline?: string
}

export type ReadClassifier = (input: {
  readonly absolutePath: string
  readonly cwd: string
}) => CompactReadClassification | undefined

export interface BeforeAgentStartHandlerOptions {
  previewSafe?: boolean
}

export interface SenpiExtensionAPI {
  readonly sessionKind?: "interactive" | "worker"
  /**
   * Absolute cwd of the session this extension instance was loaded for. senpi builds one
   * ExtensionAPI per session and already knows the value at load time. Optional because hosts
   * older than the release that added it do not report one; consumers fall back to process.cwd().
   */
  readonly cwd?: string
  /**
   * Opaque labels the opener attached to THIS session (senpi `open_session.context`). One extension
   * set serves every session of the shared daemon, so components gate themselves on the role here
   * instead of on process-wide environment variables. Optional: hosts older than the release that
   * added it report none, and consumers fall back to the per-child process env.
   */
  readonly sessionContext?: unknown
  on(
    event: string,
    handler: (payload: unknown, ctx?: unknown) => unknown | Promise<unknown>,
    options?: BeforeAgentStartHandlerOptions,
  ): void
  rpc?: {
    emit(name: string, data: unknown): void
    handle?(name: string, handler: (data: unknown) => unknown | Promise<unknown>): void
  }
  events?: {
    emit(name: string, data: unknown): void
    on(name: string, handler: (payload: unknown) => void): () => void
  }
  registerTool(tool: Record<string, unknown>): void
  registerCommand(name: string, options: Record<string, unknown>): void
  registerFlag(
    name: string,
    options: {
      description?: string
      type: "boolean" | "string"
      default?: boolean | string
    },
  ): void
  getFlag(name: string): boolean | string | undefined
  /** The session's current name (`/name`, `set_session_name`); undefined when it has none. */
  getSessionName?(): string | undefined
  /** The permission preset senpi enforces for this session (senpi #3301); undefined without the permission system. */
  getPermissionPreset?(): string | undefined
  sendMessage(message: Record<string, unknown>, options?: Record<string, unknown>): void | Promise<void>
  sendUserMessage(content: string | readonly Record<string, unknown>[], options?: { deliverAs?: "steer" | "followUp" }): void
  /** senpi's slash-command registry: extension commands, prompt templates, and `skill:<name>` entries. */
  getCommands?(): readonly {
    readonly name: string
    readonly description?: string
    readonly source: string
    readonly sourceInfo?: { readonly path?: string }
  }[]
  /** Feature-detected until the pinned Senpi runtime exports read classifiers. */
  registerReadClassifier?(classifier: ReadClassifier): () => void
  registerRemovedToolHint?(name: string, hint: string): void
  /** Feature-detected: senpi runtimes before 2026.10.7 have no eval-handle capability slot. */
  provideEvalHandleHost?(host: EvalHandleHost): void
  registerMessageRenderer?(customType: string, renderer: unknown): void
  /** `options.startupBookkeeping` (senpi#3329): older hosts ignore the third argument. */
  appendEntry?(customType: string, data?: unknown, options?: { readonly startupBookkeeping?: boolean }): void
  registerMcpServer?(name: string, config: Record<string, unknown>): void
  /**
   * Every subscription account's latest limit windows, polled and kept by the engine (senpi#3684).
   * Feature-detected: older hosts expose nothing, and the panel then shows no usage section.
   */
  getSubscriptionLimits?(): readonly SenpiAccountLimits[]
  onSubscriptionLimits?(listener: (limits: SenpiAccountLimits) => void): () => void
  /** The running senpi version (code-yeongyu/senpi#3674); hosts before it report none. */
  readonly hostVersion?: string
  /**
   * senpi's one upload redactor (code-yeongyu/senpi#3674), the same path `/share` uses. Feature-detected: hosts older
   * than the release that added it expose nothing, and nothing may be uploaded without it.
   */
  redactForUpload?(
    text: string,
    options?: { readonly extraLiterals?: readonly string[] },
  ): { readonly text: string; readonly counts: Readonly<Record<string, number>> }
  /**
   * The engine's session lifecycle (senpi#3864). `markRunCompleted` tells it a workflow run finished inside the
   * current epoch, so the epoch's `done` reads `completion.kind = "run"`. Feature-detected: hosts before senpi
   * 2026.10.23-1 expose nothing.
   */
  readonly lifecycle?: {
    markRunCompleted(run: { readonly runId: string }): void
  }
  /** Run a command. Feature-detected: hosts older than the release that added it expose nothing. */
  exec?(
    command: string,
    args: string[],
    options?: { cwd?: string; timeout?: number },
  ): Promise<{ stdout: string; stderr: string; code: number }>
}

/** One account's record in senpi's subscription-limit store, as `get_subscription_limits` serves it. */
export interface SenpiAccountLimits {
  readonly provider: string
  readonly account: string
  readonly windows: readonly {
    readonly id: string
    readonly label: string
    readonly windowMinutes?: number
    readonly usedPercent: number
    readonly resetsAt?: string
  }[]
  readonly reportedAt: string
  readonly plan?: string
  readonly error?: string
}

export interface ComponentLogger {
  /** Optional: hosts without a debug channel simply drop expected-state diagnostics. */
  debug?(message: string, details?: unknown): void
  info(message: string, details?: unknown): void
  warn(message: string, details?: unknown): void
  error(message: string, details?: unknown): void
}

export interface ComponentContext {
  logger: ComponentLogger
  config: {
    getFlag(name: string): boolean | string | undefined
  }
  // Registration-time capture registry (todo 17): every full ToolDefinition registered by any omo
  // component, captured with its live execute closure. Absent in isolated component unit tests.
  getCapturedTools?(): readonly ToolDefinition[]
  // Single-queue idle-edge injection arbiter (todo 17). When present, ulw-loop continuation and task
  // completion wakes route through it so one idle edge yields exactly one injection.
  idleCoordinator?: IdleInjectionCoordinator
  // Off-critical-path scheduler for startup work that must happen but is not needed before the
  // first user turn (see startup-deferral.ts). Absent in isolated component unit tests, where
  // `deferUntilAfterFirstPaint` runs the work inline instead.
  deferStartupWork?: (label: string, work: StartupWork) => void
}

export interface OmoSenpiComponent {
  name: string
  register(pi: SenpiExtensionAPI, ctx: ComponentContext): void | Promise<void>
}
