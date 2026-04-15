import type { PluginInput } from "@opencode-ai/plugin";
import { ALLOWED_AGENTS } from "./constants";
import { normalizeSDKResponse } from "../../shared";
import { log } from "../../shared/logger";

type AgentInfo = {
  name: string;
  mode?: "subagent" | "primary" | "all";
};

const callableAgentsCache = new Map<string, { agents: string[]; timestamp: number }>();
const CACHE_TTL_MS = 30_000;

export function clearCallableAgentsCache(): void {
  callableAgentsCache.clear();
}

/**
 * Resolves the set of callable agent names at execute-time by merging the
 * hardcoded `ALLOWED_AGENTS` with any additional agents discovered dynamically
 * via `client.app.agents()`. Custom agents loaded from registered agent
 * directories appear here alongside built-ins.
 *
 * Results are cached per session for 30s to avoid redundant SDK IPC calls.
 *
 * Falls back to `ALLOWED_AGENTS` alone if the dynamic lookup fails.
 *
 * @param client - The plugin client with access to the agent registry
 * @param sessionId - Optional session ID for cache scoping
 * @returns Array of lowercase callable agent names (excludes primary-mode agents)
 */
export async function resolveCallableAgents(
  client: PluginInput["client"],
  sessionId?: string,
): Promise<string[]> {
  const cacheKey = sessionId ?? "__default__";
  const cached = callableAgentsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.agents;
  }

  try {
    const agentsResult = await client.app.agents();
    const agents = normalizeSDKResponse(agentsResult, [] as AgentInfo[], {
      preferResponseOnMissingData: true,
    });

    const dynamicAgents = agents
      .filter((a) => a && typeof a.name === "string" && a.name.trim().length > 0 && a.mode !== "primary")
      .map((a) => a.name.trim().toLowerCase());

    const merged = new Set([...ALLOWED_AGENTS, ...dynamicAgents]);
    const result = [...merged];
    callableAgentsCache.set(cacheKey, { agents: result, timestamp: Date.now() });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(
      "[call_omo_agent] Failed to resolve dynamic agents, falling back to built-in list",
      { error: message },
    );
    return [...ALLOWED_AGENTS];
  }
}
