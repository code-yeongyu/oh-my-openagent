import type { PluginInput } from "@opencode-ai/plugin"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { isOracleAgent } from "./agent-matcher"
import { getAgentFromSession } from "./agent-resolution"
import { BLOCKED_TOOLS, HOOK_NAME, PLANNING_CONSULT_WARNING, PROMETHEUS_WORKFLOW_REMINDER } from "./constants"
import { isAllowedFile } from "./path-policy"

const TASK_TOOLS = ["task", "delegate_agent"]

export function createOracleMdOnlyHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isOracleAgent(agentName)) {
        return
      }

      const toolName = input.tool

      // Inject read-only warning for task tools called by Oracle
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
         log(`[${HOOK_NAME}] Blocked: Oracle can only write to .matrixx/*.md`, {
           sessionID: input.sessionID,
           tool: toolName,
           filePath,
           agent: agentName,
         })
         throw new Error(
           `[${HOOK_NAME}] ${getAgentDisplayName("oracle")} can only write/edit .md files inside .matrixx/ directory. ` +
           `Attempted to modify: ${filePath}. ` +
           `${getAgentDisplayName("oracle")} is a READ-ONLY planner. Use /start-work to execute the plan. ` +
           `APOLOGIZE TO THE USER, REMIND OF YOUR PLAN WRITING PROCESSES, TELL USER WHAT YOU WILL GOING TO DO AS THE PROCESS, WRITE THE PLAN`
         )
       }

      const normalizedPath = filePath.toLowerCase().replace(/\\/g, "/")
      if (normalizedPath.includes(".matrixx/plans/") || normalizedPath.includes(".matrixx\\plans\\")) {
        log(`[${HOOK_NAME}] Injecting workflow reminder for plan write`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
        })
        output.message = (output.message || "") + PROMETHEUS_WORKFLOW_REMINDER
      }

      log(`[${HOOK_NAME}] Allowed: .matrixx/*.md write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}
