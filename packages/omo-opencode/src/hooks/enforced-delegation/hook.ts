import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { resolveMessageEventSessionID, resolveSessionEventID } from "../../shared/event-session-id"

const ORCHESTRATOR_AGENTS = new Set([
  "sisyphus",
  "sisyphus-junior",
  "atlas",
  "hephaestus",
  "prometheus",
])

function isOrchestratorAgent(agentName: string): boolean {
  return ORCHESTRATOR_AGENTS.has(getAgentConfigKey(agentName))
}

const DELEGABLE_HEAVY_TOOLS = new Set([
  "write",
  "edit",
  "multiedit",
  "grep",
  "safe_grep",
  "glob",
  "safe_glob",
])

export function createEnforcedDelegationHook(ctx: PluginInput, pluginConfig: OhMyOpenCodeConfig) {
  const tokenCache = new Map<string, number>()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined
    if (event.type === "session.deleted") {
      const sessionID = resolveSessionEventID(props)
      if (sessionID) {
        tokenCache.delete(sessionID)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        role?: string
        tokens?: { input?: number; cache?: { read?: number }; output?: number }
      } | undefined

      const sessionID = resolveMessageEventSessionID(props)
      if (sessionID && info && info.role === "assistant" && info.tokens) {
        const inputTokens = (info.tokens.input ?? 0) + (info.tokens.cache?.read ?? 0)
        const outputTokens = info.tokens.output ?? 0
        tokenCache.set(sessionID, inputTokens + outputTokens)
      }
    }
  }

  const toolExecuteBefore = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown }
  ) => {
    const { tool, sessionID } = input
    const toolLower = tool.toLowerCase()
    
    // 1. Only enforce on heavy delegable tools
    if (!DELEGABLE_HEAVY_TOOLS.has(toolLower)) {
      return
    }

    // 2. Only enforce on orchestrator sessions
    const agent = getSessionAgent(sessionID)
    if (!agent || !isOrchestratorAgent(agent)) {
      return
    }

    // 3. Check session token count
    const threshold = pluginConfig.enforce_subagent_threshold_tokens ?? 20_000
    const currentTokens = tokenCache.get(sessionID) ?? 0

    if (currentTokens >= threshold) {
      // Show TUI Toast
      if (ctx.client.tui?.showToast) {
        ctx.client.tui.showToast({
          body: {
            title: "SUBAGENT DELEGATION ENFORCED",
            message: `Context is too large (${currentTokens} tokens). Blocked direct execution of '${tool}'.`,
            variant: "warning",
            duration: 5000,
          }
        }).catch(() => {})
      }

      // Throw an error to block the tool execution and instruct the orchestrator model
      throw new Error(
        `Error: Main orchestrator session context is too large (${currentTokens} tokens). ` +
        `Direct execution of search/file-editing tool '${tool}' is blocked to control cost. ` +
        `You MUST delegate this task to a subagent using the 'delegate-task' tool. ` +
        `For example, call task(subagent_type="coder", prompt="...") to edit files, or subagent_type="explore" to search.`
      )
    }
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    event: eventHandler,
  }
}
