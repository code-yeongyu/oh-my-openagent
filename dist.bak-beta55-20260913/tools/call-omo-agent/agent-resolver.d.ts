import type { PluginInput } from "@opencode-ai/plugin";
export declare function clearCallableAgentsCache(): void;
/**
 * Resolves the set of callable agent names for call_omo_agent.
 *
 * This tool is deliberately narrower than delegate-task: it may only launch
 * the research lookup agents used by worker-style agents while they continue
 * local work. Dynamic agents and other built-ins must go through task().
 */
export declare function resolveCallableAgents(_client?: PluginInput["client"], _sessionId?: string): Promise<string[]>;
