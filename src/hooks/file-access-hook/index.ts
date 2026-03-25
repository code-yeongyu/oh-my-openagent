import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { getAgentFromSession } from "../shared/agent-resolution"
import { checkFileAccess } from "./access-checker"
import type { FileAccessConfig } from "./types"

export interface FileAccessHookConfig {
  agentConfigs: Record<string, FileAccessConfig>
}

export function createFileAccessHook(
  ctx: PluginInput,
  config: FileAccessHookConfig
) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const toolName = input.tool.toLowerCase()
      
      // Only check write/edit tools
      if (!["write", "edit"].includes(toolName)) {
        return
      }

      // Get file path from args
      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

      // Get current agent
      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)
      if (!agentName) {
        return
      }

      // Get agent's file access config
      const agentConfig = config.agentConfigs[agentName.toLowerCase()]
      if (!agentConfig) {
        // No config for this agent - allow by default
        return
      }

      // Check access
      const accessResult = checkFileAccess(filePath, agentConfig, ctx.directory)
      
      if (!accessResult.allowed) {
        log(`[file-access-hook] Blocked: ${agentName} cannot write to ${filePath}`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
          reason: accessResult.reason,
        })
        
        throw new Error(
          `[file-access-hook] ${agentName} is not allowed to ${toolName} ${filePath}. ` +
          `Reason: ${accessResult.reason}`
        )
      }

      log(`[file-access-hook] Allowed: ${agentName} can write to ${filePath}`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}

export { getAgentFromSession } from "../shared/agent-resolution"
export { checkFileAccess } from "./access-checker"
export type { FileAccessConfig, FileAccessResult } from "./types"
