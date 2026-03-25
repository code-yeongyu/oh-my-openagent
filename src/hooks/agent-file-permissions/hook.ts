import type { PluginInput } from "@opencode-ai/plugin"
import type { OhMyOpenCodeConfig } from "../../config"

import { HOOK_NAME, BLOCKED_TOOLS } from "./constants"
import { log } from "../../shared/logger"
import { getAgentDisplayName } from "../../shared/agent-display-names"
import { getAgentFromSession } from "./agent-resolution"
import { isFileAllowed } from "./matcher"

export function createAgentFilePermissionsHook(
  ctx: PluginInput,
  pluginConfig: OhMyOpenCodeConfig
) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      const toolName = input.tool

      if (!BLOCKED_TOOLS.includes(toolName)) {
        return
      }

      const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
      if (!filePath) {
        return
      }

      const agentName = await getAgentFromSession(input.sessionID, ctx.directory, ctx.client)
      if (!agentName) {
        return
      }

      const agentConfig = getAgentFilePermissions(agentName, pluginConfig)
      if (!agentConfig) {
        return
      }

      const allowPatterns = agentConfig.allow ?? []
      const denyPatterns = agentConfig.deny ?? []

      if (allowPatterns.length === 0 && denyPatterns.length === 0) {
        return
      }

      const result = isFileAllowed(filePath, ctx.directory, allowPatterns, denyPatterns)

      if (!result.allowed) {
        log(`[${HOOK_NAME}] Blocked: ${agentName} cannot edit ${filePath}`, {
          sessionID: input.sessionID,
          tool: toolName,
          filePath,
          agent: agentName,
          reason: result.reason,
        })
        throw new Error(
          `[${HOOK_NAME}] ${getAgentDisplayName(agentName.toLowerCase()) || agentName} ` +
          `is not allowed to edit: ${filePath}. ` +
          `Allowed patterns: ${allowPatterns.join(", ") || "none"}. ` +
          `Denied patterns: ${denyPatterns.join(", ") || "none"}. ` +
          `This action is restricted by agent file permissions configuration.`
        )
      }

      log(`[${HOOK_NAME}] Allowed: ${agentName} editing ${filePath}`, {
        sessionID: input.sessionID,
        tool: toolName,
        filePath,
        agent: agentName,
      })
    },
  }
}

function getAgentFilePermissions(
  agentName: string,
  pluginConfig: OhMyOpenCodeConfig
): { allow?: string[]; deny?: string[] } | undefined {
  const agents = pluginConfig.agents
  if (!agents) {
    return undefined
  }

  const normalizedAgentName = agentName.toLowerCase().split(" ")[0]

  for (const [key, config] of Object.entries(agents)) {
    const normalizedKey = key.toLowerCase()
    const matches = normalizedKey === normalizedAgentName ||
                    normalizedAgentName.startsWith(normalizedKey + " ")
    if (matches && config?.file_permissions) {
      return {
        allow: config.file_permissions.allow,
        deny: config.file_permissions.deny,
      }
    }
  }

  return undefined
}
