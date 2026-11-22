import { isHostWarmupSession, readSessionRole } from "@oh-my-opencode/senpi-task"

import type { TelemetrySessionRole } from "./session-role"

/**
 * The session's place in the task tree, collapsed to the closed wire vocabulary: an ordinary session is
 * `root`, every omo-spawned session (task child, DAG child, team member, any future role) is `child`,
 * and a host whose session context cannot be read is `unknown` rather than a guess or a thrown error.
 */
export function resolveTelemetrySessionRole(pi: unknown, env: NodeJS.ProcessEnv = process.env): TelemetrySessionRole {
  try {
    return readSessionRole(pi, env) === undefined ? "root" : "child"
  } catch {
    return "unknown"
  }
}

/** A host whose session context cannot be read is not a warm-up session: it reports, as `unknown`. */
export function isTelemetryHostWarmup(pi: unknown): boolean {
  try {
    return isHostWarmupSession(pi)
  } catch {
    return false
  }
}
