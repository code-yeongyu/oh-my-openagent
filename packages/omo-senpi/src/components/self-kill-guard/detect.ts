/**
 * Self-kill command detection.
 *
 * The senpi/omo agent runtime executes as a node.exe (or bun) process on the
 * host. A shell command that kills every node/bun process therefore terminates
 * the session that is executing it - the agent kills its own host. This module
 * recognizes those command shapes so a guard can refuse them before they run.
 *
 * Observed incident (2026-07-30/31, Windows): an agent trying to clean up stale
 * Vite dev servers ran `taskkill /F /IM node.exe`, then per-PID loops over
 * `tasklist | grep -i node`, killing the senpi host 4 times in one session.
 */

export interface SelfKillDetection {
  /** Stable rule key (used for tests and the notice details). */
  readonly key: string
  /** Human-readable explanation of why the command was refused. */
  readonly reason: string
}

/** Image names that host the agent runtime (Windows: node.exe; bun launcher). */
const HOST_IMAGE = /["']?(?:node|bun)(?:\.exe)?["']?(?=\s|$|[^\w])/i

/**
 * taskkill by image name: `taskkill /F /IM node.exe /T` (Git-Bash mangles the
 * leading slash into `//`, so both `/IM` and `//IM` must match).
 */
const TASKKILL_BY_IMAGE =
  /\btaskkill\b[\s\S]{0,120}(?:\/\/?|-)IM\s+["']?(?:node|bun)(?:\.exe)?["']?(?=\s|$|[^\w])/i

/** POSIX kill-by-name variants (WSL/MSYS/remote shells). */
const PKILL_NODE = /\bpkill\b\s+(?:-\w+\s+)*["']?(?:node|bun)(?:\.exe)?["']?(?=\s|$|[^\w])/i
const KILLALL_NODE = /\bkillall\b\s+["']?(?:node|bun)(?:\.exe)?["']?(?=\s|$|[^\w])/i
const TSKILL_NODE = /\btskill\b\s+["']?(?:node|bun)(?:\.exe)?["']?(?=\s|$|[^\w])/i

/** PowerShell: `Stop-Process -Name node*` or `Get-Process node | Stop-Process`. */
const STOP_PROCESS_NODE =
  /\bstop-process\b[\s\S]{0,200}?\bnode(?:\.exe)?\b|\bnode(?:\.exe)?\b[\s\S]{0,200}?\bstop-process\b/i

/** WMIC: `wmic process where name='node.exe' delete`. */
const WMIC_NODE_DELETE =
  /\bwmic\b[\s\S]{0,240}?\bnode(?:\.exe)?\b[\s\S]{0,120}?\bdelete\b/i

interface SegmentRule {
  readonly key: string
  readonly pattern: RegExp
}

const SEGMENT_RULES: readonly SegmentRule[] = [
  { key: "taskkill-image-node", pattern: TASKKILL_BY_IMAGE },
  { key: "pkill-node", pattern: PKILL_NODE },
  { key: "killall-node", pattern: KILLALL_NODE },
  { key: "tskill-node", pattern: TSKILL_NODE },
  { key: "stop-process-node", pattern: STOP_PROCESS_NODE },
  { key: "wmic-node-delete", pattern: WMIC_NODE_DELETE },
]

/**
 * Whole-command rules for shapes that no single segment captures, e.g. a PID
 * loop that lists node processes in one pipeline and taskkills them in another:
 *
 *   for pid in $(tasklist 2>/dev/null | grep -i node | awk '{print $2}'); do
 *     taskkill //F //PID "$pid" >/dev/null 2>&1
 *   done
 */
interface WholeCommandRule {
  readonly key: string
  readonly test: (command: string) => boolean
}

function hasNodeKillLoop(command: string): boolean {
  if (!/\btaskkill\b/i.test(command)) return false
  if (!HOST_IMAGE.test(command)) return false
  return /\b(?:tasklist|wmic|get-process|for\s+\w+\s+in|while\s+read)\b/i.test(command)
}

function hasPowerShellPipeToStop(command: string): boolean {
  if (!/\bnode(?:\.exe)?\b/i.test(command)) return false
  return /\bget-process\b[\s\S]{0,200}?\bstop-process\b/i.test(command)
}

const WHOLE_COMMAND_RULES: readonly WholeCommandRule[] = [
  { key: "node-pid-kill-loop", test: hasNodeKillLoop },
  { key: "powershell-get-process-stop", test: hasPowerShellPipeToStop },
]

const hostNote = (what: string) => `${what} would kill this session's host.`

export const SELF_KILL_REASONS: Readonly<Record<string, string>> = {
  "taskkill-image-node": "taskkill by image name would kill all node/bun processes, this session included.",
  "node-pid-kill-loop": "a PID loop over node processes would include this session's host.",
  "pkill-node": hostNote("pkill node"),
  "killall-node": hostNote("killall node"),
  "tskill-node": hostNote("tskill node"),
  "stop-process-node": hostNote("Stop-Process/Get-Process on node"),
  "wmic-node-delete": hostNote("wmic delete on node.exe"),
  "powershell-get-process-stop": hostNote("Get-Process node | Stop-Process"),
}

/**
 * Split a shell command into logical segments. Splitting is deliberately
 * conservative (quoted `|` may split mid-string); for a kill guard a slight
 * over-approximation is acceptable and a missed case is not.
 */
export function splitCommandSegments(command: string): readonly string[] {
  return command
    .split(/(?:&&|\|\||;|\n|\||\$\(|`)/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
}

/**
 * Detect whether `command` would terminate the agent's own host process.
 * Returns the matched rule (with a stable key and explanation) or undefined.
 */
export function detectSelfTerminatingCommand(command: string): SelfKillDetection | undefined {
  for (const rule of WHOLE_COMMAND_RULES) {
    if (rule.test(command)) {
      return { key: rule.key, reason: SELF_KILL_REASONS[rule.key] }
    }
  }
  for (const segment of splitCommandSegments(command)) {
    for (const rule of SEGMENT_RULES) {
      rule.pattern.lastIndex = 0
      if (rule.pattern.test(segment)) {
        return { key: rule.key, reason: SELF_KILL_REASONS[rule.key] }
      }
    }
  }
  return undefined
}
