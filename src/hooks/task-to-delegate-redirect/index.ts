import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared"

/**
 * Hook to redirect native OpenCode `task` tool calls to `delegate_task`.
 * 
 * The native `task` tool has known issues with token refresh and empty responses
 * for certain agents (metis, oracle, momus, etc.). This hook intercepts `task` calls
 * and transforms them to use `delegate_task` which has more robust error handling.
 * 
 * See: https://github.com/code-yeongyu/oh-my-opencode/issues/1281
 */

// Agents that have issues with native `task` tool
const PROBLEMATIC_AGENTS = ["metis", "momus", "oracle", "atlas"]

export function createTaskToDelegateRedirectHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { 
        tool: string
        args: Record<string, unknown>
        title?: string
        metadata?: unknown 
      }
    ) => {
      if (input.tool.toLowerCase() !== "task") return

      const args = output.args
      const subagentType = (args.subagent_type as string)?.toLowerCase() ?? ""

      const isProblematic = PROBLEMATIC_AGENTS.some(
        (agent) => subagentType === agent.toLowerCase()
      )

      if (!isProblematic) return

      log("[task-to-delegate-redirect] Redirecting task to delegate_task", {
        sessionID: input.sessionID,
        subagentType,
      })

      // Transform to delegate_task format
      output.tool = "delegate_task"
      output.args = {
        subagent_type: args.subagent_type,
        description: args.description ?? "Redirected task",
        prompt: args.prompt ?? "",
        session_id: args.session_id,
        run_in_background: false,
        load_skills: [],
      }
    },
  }
}
