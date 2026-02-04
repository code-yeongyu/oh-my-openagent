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

  if (toolName !== "Bash" && toolName !== "interactive_bash") {
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

  if (context.toolName === "Bash") {
    return (toolInput.command as string) ?? ""
  }

  if (context.toolName === "interactive_bash") {
    return (toolInput.tmux_command as string) ?? ""
  }

  return ""
}
