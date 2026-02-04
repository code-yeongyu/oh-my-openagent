import type { PreToolUseContext } from "./pre-tool-use"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { classifyGitCommand } from "./git-command-classifier"

export interface GitWriteEnforcementResult {
  blocked: boolean
  reason?: string
}

export function enforceGitWriteRestriction(
  context: PreToolUseContext,
  config: OhMyOpenCodeConfig
): GitWriteEnforcementResult {
  const toolName = context.toolName
  const toolLower = toolName.toLowerCase()
  const isBashTool = toolLower === "bash" || toolLower === "mcp_bash"
  const isInteractiveBash = toolLower === "interactive_bash"

  if (!isBashTool && !isInteractiveBash) {
    return { blocked: false }
  }

  const command = extractCommand(context)
  if (!command) {
    return { blocked: false }
  }

  const classification = classifyGitCommand(command)

  if (!classification.isGit || !classification.isWrite) {
    return { blocked: false }
  }

  const agent = context.agent

  if (agent === "git-owner") {
    return { blocked: false }
  }

  return {
    blocked: true,
    reason: "Git write blocked. Delegate to git-owner agent for: commit, push, merge operations.",
  }
}

function extractCommand(context: PreToolUseContext): string {
  const toolInput = context.toolInput
  const toolLower = context.toolName.toLowerCase()

  if (toolLower === "bash" || toolLower === "mcp_bash") {
    return (toolInput.command as string) ?? ""
  }

  if (toolLower === "interactive_bash") {
    return (toolInput.tmux_command as string) ?? ""
  }

  return ""
}
