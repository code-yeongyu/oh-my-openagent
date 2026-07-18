import type { ThemeColor } from "@code-yeongyu/senpi"
import type { ChildModelRegistry, ParentState } from "@oh-my-opencode/senpi-task"

// Structural slice of senpi's Theme the status UI paints with. The real Theme instance exposed on
// ExtensionUIContext satisfies it; headless/test fakes simply omit it and get plain text.
export interface StatusTheme {
  fg(color: ThemeColor, text: string): string
}

// Structural slice of senpi's ExtensionContext the task runtime reads. ExtensionContext satisfies it;
// tests pass a tiny fake. `ui` lives on ExtensionContext (event/command contexts), NOT ExtensionAPI,
// so it is captured here on entry and cleared on switch/shutdown (the todo-18 bridge constraint).
// modelRegistry is the CONCRETE senpi ModelRegistry: the planner reads it through its structural port,
// and in-process children reuse this exact instance so they inherit the parent's live provider set.
export interface LiveTaskContext {
  readonly cwd?: string
  readonly modelRegistry?: ChildModelRegistry
  readonly model?: unknown
  readonly ui?: CapturedUi
  readonly mode?: string
  readonly hasUI?: boolean
  readonly sessionManager?: {
    getSessionId(): string
    getSessionFile?(): string | undefined
  }
  isIdle?(): boolean
}

// The slice of senpi's ExtensionUIContext the task component drives (setStatus/setWidget power the
// footer + below-editor widget, select/confirm power /task-kill, notify powers headless-safe warnings).
// senpi's real ExtensionUIContext satisfies this structurally.
export interface CapturedUi {
  readonly theme?: StatusTheme
  notify(message: string, type?: "info" | "warning" | "error"): void
  setStatus(key: string, text: string | undefined): void
  setWidget(key: string, content: string[] | undefined, options?: { placement?: "belowEditor" | "aboveEditor" }): void
  select(title: string, options: string[], opts?: { signal?: unknown; timeout?: number }): Promise<string | undefined>
  confirm(title: string, message: string, opts?: { signal?: unknown; timeout?: number }): Promise<boolean>
}

export type ParentTransition = "compacting" | "session_switching" | "session_shutdown" | undefined

/**
 * Mutable holder for the latest live-context facts. The manager's planner and in-process runner are
 * constructed once at registration, but resolve model/registry lazily through this holder; the
 * completion bridge reads parentState from it. A captured UI handle powers headless-safe notifies.
 */
export class TaskRuntimeContext {
  #cwd: string
  #modelRegistry: ChildModelRegistry | undefined
  #idle = true
  #transition: ParentTransition
  #ui: CapturedUi | undefined
  #sessionId: string | undefined
  #sessionFile: string | undefined
  #mode: string | undefined

  constructor(cwd: string) {
    this.#cwd = cwd
  }

  captureFrom(ctx: LiveTaskContext): void {
    if (typeof ctx.cwd === "string" && ctx.cwd.length > 0) this.#cwd = ctx.cwd
    if (ctx.modelRegistry !== undefined) this.#modelRegistry = ctx.modelRegistry
    if (ctx.ui !== undefined) this.#ui = ctx.ui
    if (typeof ctx.mode === "string") this.#mode = ctx.mode
    if (ctx.sessionManager !== undefined) {
      this.#sessionId = ctx.sessionManager.getSessionId()
      this.#sessionFile = ctx.sessionManager.getSessionFile?.()
    }
    if (typeof ctx.isIdle === "function") this.#idle = ctx.isIdle()
  }

  clearUi(): void {
    this.#ui = undefined
  }

  setTransition(transition: ParentTransition): void {
    this.#transition = transition
  }

  cwd(): string {
    return this.#cwd
  }

  modelRegistry(): ChildModelRegistry | undefined {
    return this.#modelRegistry
  }

  ui(): CapturedUi | undefined {
    return this.#ui
  }

  sessionId(): string | undefined {
    return this.#sessionId
  }

  sessionFile(): string | undefined {
    return this.#sessionFile
  }

  mode(): string | undefined {
    return this.#mode
  }

  parentState(): ParentState {
    if (this.#transition === "compacting") return { kind: "compacting" }
    if (this.#transition === "session_switching") return { kind: "session_switching" }
    if (this.#transition === "session_shutdown") return { kind: "session_shutdown" }
    return this.#idle ? { kind: "idle" } : { kind: "streaming" }
  }
}
