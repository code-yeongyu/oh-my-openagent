import type { PreToolUseContext } from "./pre-tool-use"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { classifyKubectlCommand } from "./kubectl-command-classifier"

export interface KubectlWriteEnforcementResult {
  blocked: boolean
  reason?: string
}

export function enforceKubectlWriteRestriction(
  context: PreToolUseContext,
  config: OhMyOpenCodeConfig
): KubectlWriteEnforcementResult {
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

  const classification = classifyKubectlCommand(command)

  if (!classification.isKubectl) {
    return { blocked: false }
  }

  const agent = context.agent

  if (classification.isDangerous && agent !== "k8s-owner") {
    return {
      blocked: true,
      reason: "Kubectl dangerous operation blocked. Delegate to k8s-owner agent for: scale, delete, apply operations.",
    }
  }

  if (classification.isContextSwitch && agent !== "k8s-owner") {
    return {
      blocked: true,
      reason: "Kubectl context switch blocked. Delegate to k8s-owner agent for: context switching operations.",
    }
  }

  return { blocked: false }
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
