import type { PluginInput } from "@opencode-ai/plugin";
import { ALLOWED_AGENTS } from "./constants";

export function clearCallableAgentsCache(): void {
  // Kept for existing test setup and external callers; the resolver is now static.
}

/**
 * Resolves the set of callable agent names for call_omo_agent.
 *
 * This tool is deliberately narrower than delegate-task: it may only launch
 * research lookup agents and the plan agent direct path used to avoid wrapping
 * plan in delegate-task's sync poller. Dynamic agents and other built-ins must
 * go through task().
 */
export async function resolveCallableAgents(
  _client?: PluginInput["client"],
  _sessionId?: string,
): Promise<string[]> {
  return [...ALLOWED_AGENTS];
}
