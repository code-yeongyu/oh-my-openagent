import * as p from "@clack/prompts"
import color from "picocolors"
import type { ConfigEditorState, ValidationWarning } from "./types"
import { AGENT_NAMES } from "./types"

export function validateConfig(state: ConfigEditorState): ValidationWarning[] {
  const warnings: ValidationWarning[] = []
  const agents = state.config.agents ?? {}

  for (const agentName of AGENT_NAMES) {
    const agent = agents[agentName]
    if (!agent) continue

    const hasModel = agent.model && agent.model.length > 0
    const hasCategory = agent.category && agent.category.length > 0

    if (!hasModel && !hasCategory) {
      warnings.push({
        type: "missing-model",
        agent: agentName,
        message: `Agent "${agentName}" has no model or category set`,
      })
    }
  }

  return warnings
}

export function checkFallbackWarnings(state: ConfigEditorState): ValidationWarning[] {
  const warnings: ValidationWarning[] = []
  const agents = state.config.agents ?? {}

  for (const agentName of AGENT_NAMES) {
    const agent = agents[agentName]
    if (!agent) continue

    const hasModel = agent.model && agent.model.length > 0
    const hasCategory = agent.category && agent.category.length > 0

    if ((hasModel || hasCategory) && !agent.model) {
      warnings.push({
        type: "missing-fallback",
        agent: agentName,
        message: `Agent "${agentName}" has category but no fallback model configured`,
      })
    }
  }

  return warnings
}

export function displayValidationWarnings(state: ConfigEditorState): void {
  const warnings = validateConfig(state)

  if (warnings.length === 0) {
    p.log.success(color.green("No validation warnings! Configuration looks good."))
    return
  }

  console.log()
  console.log(color.bgYellow(color.black(color.bold(" Validation Warnings "))))
  console.log()

  for (const warning of warnings) {
    const icon = warning.type === "missing-fallback" ? color.yellow("[!]") : color.red("[X]")
    console.log(`  ${icon} ${color.yellow(warning.message)}`)
  }

  console.log()
  console.log(color.dim("Tip: Run 'Agents' configuration to set missing models or categories."))
  console.log()
}

export function countWarnings(state: ConfigEditorState): number {
  return validateConfig(state).length + checkFallbackWarnings(state).length
}
