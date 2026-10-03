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
 * The sentence senpi's `startHostChildReaper` writes to stderr when Bun on Windows has no child
 * reaper (`packages/coding-agent/src/modes/rpc/child-reaper.ts`). Matched as source text: nothing else
 * a child writes is treated as this advisory.
 */
const WINDOWS_BUN_REAPER_ADVISORY = "child reaper unavailable under Bun on win32: children orphaned by a terminated worker thread stay as zombies until this host exits"
/** The shortest cut-short copy accepted at the very end of stderr, as #9347 already accepted it. */
/** The advisory up to "until this": the shortest cut-short copy accepted even after a line end, as #9347 accepted it. */
const WINDOWS_BUN_REAPER_ADVISORY_HEAD = WINDOWS_BUN_REAPER_ADVISORY.slice(
  0,
  WINDOWS_BUN_REAPER_ADVISORY.lastIndexOf(" until this") + " until this".length,
)

/**
 * True only when stderr is nothing but copies of the advisory sentence. Bun writes one copy per
 * terminated worker thread, and the handle classifies the last 4 KB of stderr, so:
 * - a copy may be split across lines at any point, and only that copy's own remaining words may
 *   follow it;
 * - when stderr fills the 4 KB tail, its first line may be any piece of a copy the tail cut, and that
 *   copy's remaining words must follow;
 * - the last copy may stop short: anywhere when the kill cut it mid-write (no line end after it),
 *   otherwise not before the advisory's head.
 * A line holding anything else - including the advisory's head followed by other text - makes the
 * exit a crash.
 */
function hasOnlyWindowsStartupAdvisories(stderr: string): boolean {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0)
  const first = lines[0]
  if (first === undefined) return false
  let owed: string | undefined
  let rest = lines
  if (stderr.length >= STDERR_TAIL_CAP && !WINDOWS_BUN_REAPER_ADVISORY.startsWith(first)) {
    const at = WINDOWS_BUN_REAPER_ADVISORY.indexOf(first)
    if (at < 0) return false
    owed = WINDOWS_BUN_REAPER_ADVISORY.slice(at + first.length).trim() || undefined
    rest = lines.slice(1)
  }
  for (const line of rest) {
    const expected = owed ?? WINDOWS_BUN_REAPER_ADVISORY
    if (!expected.startsWith(line)) return false
    owed = expected.slice(line.length).trim() || undefined
  }
  if (owed === undefined) return true
  if (!/[\r\n]$/.test(stderr)) return true
  const written = WINDOWS_BUN_REAPER_ADVISORY.slice(0, WINDOWS_BUN_REAPER_ADVISORY.length - owed.length).trimEnd()
  return written.length >= WINDOWS_BUN_REAPER_ADVISORY_HEAD.length
}

/**
 * Windows has no POSIX signal provenance: an externally terminated child is
 * reported as a plain exit code with `signal === null`, indistinguishable by
 * signal alone from a self-inflicted crash. The one fact that still separates
 * them is stderr - a crashing child writes diagnostics before dying, while a
 * terminated one has no crash output. Bun can write a known child-reaper
 * advisory during startup; that advisory alone is not a crash diagnostic.
 * POSIX is unaffected: there a real kill always carries its signal.
 */
function isWindowsExternalTermination(input: ChildExitInput, platform: NodeJS.Platform): boolean {
  return (
    platform === "win32"
    && input.signal === null
    && input.code === WINDOWS_TERMINATION_EXIT_CODE
    && (input.stderr.trim().length === 0 || hasOnlyWindowsStartupAdvisories(input.stderr))
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
