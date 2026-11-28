import { resolveAgentHome } from "../../agent-home"

/**
 * Where omo looks for the key record of a task host it dials: SENPI_RPC_KEY_ROOT when set, else the agent dir the host
 * runs under (the caller's, or omo's own). omo's own dial and every engine client omo opens follow this one rule, so
 * both authenticate a host under the same root: since senpi#7568 the engine client refuses a host whose key record is
 * missing under its root, and its own default (the engine's agent dir) is not always the dir omo started the host in.
 */
export function hostKeyRoot(agentDir?: string): string {
  return process.env.SENPI_RPC_KEY_ROOT?.trim() || (agentDir ?? resolveAgentHome({ env: process.env }))
}
