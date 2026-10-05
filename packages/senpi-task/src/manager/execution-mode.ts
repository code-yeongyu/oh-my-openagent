export type ExecutionMode = "in-process" | "process"

/** What omo.json may say: either mode, or `auto` = let the shared task daemon decide. */
export type ConfiguredExecutionMode = ExecutionMode | "auto"

/** Which runner a `process` child gets (omo.json `task.process_runner`). */
export type ProcessRunnerKind = "host" | "child-process"

export type ExecutionModeSources = {
  readonly specMode?: ExecutionMode
  readonly agentMode?: ExecutionMode
  readonly configMode?: ConfiguredExecutionMode
  // The parent session's ONE resolution of `auto`. Absent until the first daemon ensure settles;
  // an unresolved `auto` reads as in-process, so no child is ever routed on a guess.
  readonly autoMode?: ExecutionMode
}

// Precedence: spec.execution_mode ?? agentDef.executionMode ?? omo.json task.default_execution_mode
// ?? "in-process". A configured "auto" contributes the parent session's resolved auto mode, so a
// user-set "in-process"/"process" (and every per-agent override) still wins over the daemon check.
export function resolveExecutionMode(sources: ExecutionModeSources): ExecutionMode {
  const configured = sources.configMode === "auto" ? sources.autoMode : sources.configMode
  return sources.specMode ?? sources.agentMode ?? configured ?? "in-process"
}

/**
 * What the ensured daemon must advertise before `auto` routes children to it as sessions:
 * `session_context` (the plugin gates itself per session by the role omo attaches) and
 * `generation_handoff` (an engine upgrade parks and reopens children instead of killing them).
 */
export const AUTO_HOST_CAPABILITIES = ["session_context", "generation_handoff"] as const

export type AutoExecutionModeInput = {
  readonly platform: NodeJS.Platform
  readonly processRunner: ProcessRunnerKind
  // `get_protocol_info.capabilities` of the ensured daemon; undefined = no daemon to host children.
  readonly capabilities: readonly string[] | undefined
}

/** The `auto` decision itself: pure, so the once-per-session gate below is the only stateful part. */
export function resolveAutoExecutionMode(input: AutoExecutionModeInput): ExecutionMode {
  if (input.platform === "win32" || input.processRunner !== "host") return "in-process"
  const advertised = new Set(input.capabilities ?? [])
  return AUTO_HOST_CAPABILITIES.every((capability) => advertised.has(capability)) ? "process" : "in-process"
}

/**
 * The parent session's memoized `auto` resolution. `ensure()` asks the daemon at most once per
 * parent session and never rejects (an unavailable daemon settles on in-process), so a child's mode
 * cannot change because the daemon died later in the session - the mode is a session fact.
 */
export interface ExecutionModeGate {
  /** The resolved mode, or undefined while no ensure has settled yet. */
  current(): ExecutionMode | undefined
  ensure(): Promise<ExecutionMode>
  /**
   * A speculative ask ahead of the first spawn (the task-host pre-warm). An answer is kept exactly as
   * `ensure()` would keep it; a FAILED ask is dropped, so the first spawn's `ensure()` asks again and a
   * pre-warm can never decide the session's mode by failing. An `ensure()` issued while the warm is in
   * flight joins it. Never rejects.
   */
  warm(): Promise<void>
}

export interface ExecutionModeGateHooks {
  /** A failed `ensure()`: the session settles on in-process. */
  readonly onEnsureFailure?: (error: unknown) => void
  /** A failed `warm()`: nothing is settled. */
  readonly onWarmFailure?: (error: unknown) => void
  /**
   * The host runner's admission precondition, checked before the first ask (which may ensure the
   * session's host): the task store is durably in the agent-dir store index. False = the index cannot
   * take it; that spawn goes to the host runner, whose own admission fails it as
   * `store_index_unavailable`, and nothing is settled, so the next spawn asks again.
   */
  readonly admit?: () => Promise<boolean>
}

export function createExecutionModeGate(
  resolve: () => Promise<ExecutionMode>,
  hooks: ExecutionModeGateHooks = {},
): ExecutionModeGate {
  let resolved: ExecutionMode | undefined
  let settled: Promise<ExecutionMode> | undefined
  let warming: Promise<ExecutionMode | undefined> | undefined
  const keep = (mode: ExecutionMode): ExecutionMode => {
    resolved = mode
    return mode
  }
  const settle = (): Promise<ExecutionMode> => {
    if (settled !== undefined) return settled
    settled = resolve()
      .catch((error: unknown): ExecutionMode => {
        hooks.onEnsureFailure?.(error)
        return "in-process"
      })
      .then(keep)
    return settled
  }
  const ensure = (): Promise<ExecutionMode> => {
    if (settled !== undefined) return settled
    if (warming !== undefined) return warming.then((mode) => mode ?? ensure())
    const admit = hooks.admit
    if (admit === undefined) return settle()
    return admit().then((admitted): Promise<ExecutionMode> | ExecutionMode => (admitted ? settle() : "process"))
  }
  return {
    current: () => resolved,
    ensure,
    warm: () => {
      if (settled !== undefined || warming !== undefined) return (settled ?? warming ?? Promise.resolve()).then(() => undefined)
      const attempt: Promise<ExecutionMode | undefined> = resolve().then(
        (mode) => {
          settled = Promise.resolve(keep(mode))
          return mode
        },
        (error: unknown) => {
          hooks.onWarmFailure?.(error)
          return undefined
        },
      )
      warming = attempt
      void attempt.then(() => {
        if (warming === attempt) warming = undefined
      })
      return attempt.then(() => undefined)
    },
  }
}
