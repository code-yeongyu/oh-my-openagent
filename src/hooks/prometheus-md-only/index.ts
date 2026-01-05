import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, PROMETHEUS_AGENTS, ALLOWED_EXTENSIONS, ALLOWED_PATH_PREFIX, BLOCKED_TOOLS } from "./constants"
import { log } from "../../shared/logger"

export * from "./constants"

function isAllowedFile(filePath: string): boolean {
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(ext => filePath.endsWith(ext))
  const isInAllowedPath = filePath.includes(ALLOWED_PATH_PREFIX)
  return hasAllowedExtension && isInAllowedPath
}

export function createPrometheusMdOnlyHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string; agent?: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const agentName = input.agent
      
      if (!agentName || !PROMETHEUS_AGENTS.includes(agentName)) {
        return
      }

      const toolName = input.tool
      if (!BLOCKED_TOOLS.includes(toolName)) {
        return
      }

      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

      if (!isAllowedFile(filePath)) {
        log(`[${HOOK_NAME}] Blocked: Prometheus can only write to .sisyphus/*.md`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
        })
        throw new Error(
          `[${HOOK_NAME}] Prometheus (Planner) can only write/edit .md files inside .sisyphus/ directory. ` +
          `Attempted to modify: ${filePath}. ` +
          `Prometheus is a READ-ONLY planner. Use /start-work to execute the plan.`
        )
      }

      log(`[${HOOK_NAME}] Allowed: .sisyphus/*.md write permitted`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}
