import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, BLOCKED_TOOLS } from "./constants"
import { log } from "../../shared/logger"
import { getAgentFromSession } from "../prometheus-md-only/agent-resolution"
import { isAthenaAgent } from "./agent-matcher"
import { isAllowedPath } from "./path-policy"

export function createAthenaSisyphusOnlyHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (!BLOCKED_TOOLS.includes(input.tool)) {
        return
      }

      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)

      if (!isAthenaAgent(agentName)) {
        return
      }

      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

      if (!isAllowedPath(filePath, ctx.directory)) {
        log(`[${HOOK_NAME}] Blocked: Athena attempted write outside .sisyphus/`, {
          sessionID: input.sessionID,
          tool: input.tool,
          filePath,
          agent: agentName,
        })
        throw new Error(
          `[${HOOK_NAME}] Athena can only write/edit files inside .sisyphus/ directory. Attempted to modify: ${filePath}`
        )
      }

      log(`[${HOOK_NAME}] Allowed: .sisyphus/ write permitted`, {
        sessionID: input.sessionID,
        tool: input.tool,
        filePath,
        agent: agentName,
      })
    },
  }
}
