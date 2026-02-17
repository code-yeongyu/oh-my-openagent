import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, BLOCKED_TOOLS, PLANNING_CONSULT_WARNING } from "./constants"
import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { getAgentFromSession } from "./agent-resolution"
import { isCoeusAgent } from "./agent-matcher"
import { isAllowedFile } from "./path-policy"

const TASK_TOOLS = ["task", "call_omo_agent"]

export function createCoeusMdOnlyHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isCoeusAgent(agentName)) {
        return
      }

      const toolName = input.tool

      if (TASK_TOOLS.includes(toolName)) {
        const prompt = output.args.prompt as string | undefined
        if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
          output.args.prompt = PLANNING_CONSULT_WARNING + prompt
          log(`[${HOOK_NAME}] Injected read-only planning warning to ${toolName}`, {
            sessionID: input.sessionID,
            tool: toolName,
            agent: agentName,
          })
        }
        return
      }

      if (!BLOCKED_TOOLS.includes(toolName)) {
        return
      }

      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

      if (!isAllowedFile(filePath, ctx.directory)) {
        log(`[${HOOK_NAME}] Blocked: Coeus/sub-prometheus can only write to .sisyphus/ (.md/.json)`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
        })
        throw new Error(
          `[${HOOK_NAME}] ${getAgentDisplayName("coeus")} can only write/edit .md/.json files inside .sisyphus/ directory. ` +
          `Attempted to modify: ${filePath}. ` +
          `${getAgentDisplayName("coeus")} is a READ-ONLY recursive planner. ` +
          `Plans go in .sisyphus/plans/*.md, sub-plans in .sisyphus/sub-plans/**/*.json.`
        )
      }

      log(`[${HOOK_NAME}] Allowed: .sisyphus/ write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}
