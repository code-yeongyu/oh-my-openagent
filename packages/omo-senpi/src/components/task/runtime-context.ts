import type { ParentState } from "@oh-my-opencode/senpi-task"

import type { TaskModelRegistry } from "./planner"

// Structural slice of senpi's ExtensionContext the task runtime reads. ExtensionContext satisfies it;
// tests pass a tiny fake. `ui` lives on ExtensionContext (event/command contexts), NOT ExtensionAPI,
// so it is captured here on entry and cleared on switch/shutdown (the todo-18 bridge constraint).
export interface LiveTaskContext {
  readonly cwd?: string
  readonly modelRegistry?: TaskModelRegistry
  readonly model?: unknown
  readonly ui?: CapturedUi
  isIdle?(): boolean
}

export interface CapturedUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
}

export type ParentTransition = "compacting" | "session_switching" | "session_shutdown" | undefined

/**
 * Mutable holder for the latest live-context facts. The manager's planner and in-process runner are
 * constructed once at registration, but resolve model/registry lazily through this holder; the
 * completion bridge reads parentState from it. A captured UI handle powers headless-safe notifies.
 */
export class TaskRuntimeContext {
  #cwd: string
  #modelRegistry: TaskModelRegistry | undefined
  #idle = true
  #transition: ParentTransition
  #ui: CapturedUi | undefined

  constructor(cwd: string) {
    this.#cwd = cwd
  }

  captureFrom(ctx: LiveTaskContext): void {
    if (typeof ctx.cwd === "string" && ctx.cwd.length > 0) this.#cwd = ctx.cwd
    if (ctx.modelRegistry !== undefined) this.#modelRegistry = ctx.modelRegistry
    if (ctx.ui !== undefined) this.#ui = ctx.ui
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

  modelRegistry(): TaskModelRegistry | undefined {
    return this.#modelRegistry
  }

  ui(): CapturedUi | undefined {
    return this.#ui
  }

  parentState(): ParentState {
    if (this.#transition === "compacting") return { kind: "compacting" }
    if (this.#transition === "session_switching") return { kind: "session_switching" }
    if (this.#transition === "session_shutdown") return { kind: "session_shutdown" }
    return this.#idle ? { kind: "idle" } : { kind: "streaming" }
  }
}
