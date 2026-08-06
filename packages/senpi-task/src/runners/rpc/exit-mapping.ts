import type { ChildExitFacts, ChildExitOutcome, RunnerErrorFacts } from "../types"

const STDERR_TAIL_CAP = 4_096

export type ChildExitInput = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
  readonly pid?: number
  readonly stderr: string
}

/** Keep only the last `cap` characters of a stderr buffer (default 4KB). */
export function tailStderr(stderr: string, cap: number = STDERR_TAIL_CAP): string {
  return stderr.length <= cap ? stderr : stderr.slice(stderr.length - cap)
}

/**
 * Classify how a child process ended into a discriminated exit outcome. A
 * spawn error dominates; then exit-by-signal is `killed`; a zero code is
 * `clean`; any other code is `crashed`.
 */
export function classifyChildExit(input: ChildExitInput): ChildExitOutcome {
  const facts: ChildExitFacts = {
    pid: input.pid,
    code: input.code,
    signal: input.signal,
    stderrTail: tailStderr(input.stderr),
  }
  if (input.error) {
    return { kind: "spawn_error", message: input.error.message, facts }
  }
  if (input.signal !== null) {
    return { kind: "killed", facts }
  }
  if (input.code === 0) {
    return { kind: "clean", facts }
  }
  return { kind: "crashed", facts }
}

/**
 * Map an exit outcome onto status facts, honoring the todo-3 vocabulary: there
 * is NO `killed` status - `killed` is a boolean record fact on an `error`
 * status. An exit AFTER a terminal transition is resident teardown and yields
 * null (no status change).
 */
export function mapExitOutcomeToError(
  outcome: ChildExitOutcome,
  options: { readonly alreadyTerminal: boolean },
): RunnerErrorFacts | null {
  if (options.alreadyTerminal) {
    return null
  }
  const exit = outcome.facts
  switch (outcome.kind) {
    case "killed":
      return {
        status: "error",
        killed: true,
        error_message: `RPC child killed by signal ${exit.signal} (pid=${exit.pid ?? "unknown"})`,
        exit,
      }
    case "crashed":
      return {
        status: "error",
        killed: false,
        error_message: exit.stderrTail.trim() || `RPC child exited with code ${exit.code}`,
        exit,
      }
    case "spawn_error":
      return { status: "error", killed: false, error_message: outcome.message, exit }
    default:
      return {
        status: "error",
        killed: false,
        error_message: "RPC child exited cleanly before reaching a terminal state",
        exit,
      }
  }
}
