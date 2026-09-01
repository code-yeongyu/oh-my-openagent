import type { ChildExitFacts, ChildExitOutcome, RunnerErrorFacts } from "../types"

const STDERR_TAIL_CAP = 4_096

export type ChildExitInput = {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly error?: Error
  readonly pid?: number
  readonly stderr: string
  /** Host platform; defaults to the running process. Injectable for tests. */
  readonly platform?: NodeJS.Platform
}

/**
 * Exit code Windows reports for a process ended by `TerminateProcess` (which is
 * what Node's `process.kill`/`taskkill /F` become there).
 */
const WINDOWS_TERMINATION_EXIT_CODE = 1

/**
 * Windows has no POSIX signal provenance: an externally terminated child is
 * reported as a plain exit code with `signal === null`, indistinguishable by
 * signal alone from a self-inflicted crash. The one fact that still separates
 * them is stderr - a crashing child writes diagnostics before dying, while a
 * terminated one is stopped mid-flight with an empty buffer. POSIX is
 * unaffected: there a real kill always carries its signal.
 */
function isWindowsExternalTermination(input: ChildExitInput, platform: NodeJS.Platform): boolean {
  return (
    platform === "win32"
    && input.signal === null
    && input.code === WINDOWS_TERMINATION_EXIT_CODE
    && input.stderr.trim().length === 0
  )
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
  if (input.signal !== null || isWindowsExternalTermination(input, input.platform ?? process.platform)) {
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
        error_message:
          exit.signal === null
            ? `RPC child terminated externally with exit code ${exit.code} (pid=${exit.pid ?? "unknown"})`
            : `RPC child killed by signal ${exit.signal} (pid=${exit.pid ?? "unknown"})`,
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
