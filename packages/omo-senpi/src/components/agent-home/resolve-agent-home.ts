import { join } from "node:path"
import { resolveAgentHome, type ResolveAgentHomeOptions } from "@oh-my-opencode/senpi-task/agent-home"

export { AGENT_DIR_ENV_NAMES, AGENT_HOME_SENTINEL, resolveAgentHome } from "@oh-my-opencode/senpi-task/agent-home"
export type { AgentHomeEnv, ResolveAgentHomeOptions } from "@oh-my-opencode/senpi-task/agent-home"

/**
 * Where the engine keeps session transcripts, as `<encoded session cwd>/<timestamp>_<id>.jsonl`
 * (older layouts keep them flat at the root).
 */
export function resolveAgentSessionsDirectory(options: ResolveAgentHomeOptions): string {
  return join(resolveAgentHome(options), "sessions")
}
