import * as p from "@clack/prompts"
import color from "picocolors"
import type { AgentOverrideConfig } from "../../config/schema"
import type { ConfigEditorState, BashPermissionValue } from "./types"
import { AGENT_NAMES, AVAILABLE_MODELS } from "./types"

type ExtendedAgentConfig = AgentOverrideConfig & { fallback_model?: string }

function getAgentsRecord(state: ConfigEditorState): Record<string, ExtendedAgentConfig> {
  return (state.config.agents ?? {}) as Record<string, ExtendedAgentConfig>
}

async function setModelForAllAgents(state: ConfigEditorState): Promise<void> {
  const model = await p.select({
    message: "Select model to set for ALL agents:",
    options: [
      ...AVAILABLE_MODELS.map((m) => ({ value: m, label: m })),
      { value: "__custom__", label: "Custom model..." },
      { value: "__back__", label: "Back" },
    ],
  })

  if (p.isCancel(model) || model === "__back__") return

  let finalModel: string
  if (model === "__custom__") {
    const custom = await p.text({
      message: "Enter custom model name:",
      validate: (value) => {
        if (!value.trim()) return "Model name is required"
        return undefined
      },
    })
    if (p.isCancel(custom)) return
    finalModel = custom.trim()
  } else {
    finalModel = model
  }

  const confirm = await p.confirm({
    message: `Set model "${finalModel}" for all ${AGENT_NAMES.length} agents?`,
    initialValue: false,
  })

  if (p.isCancel(confirm) || !confirm) {
    p.log.info("Cancelled")
    return
  }

  const s = p.spinner()
  s.start("Applying model to all agents...")

  if (!state.config.agents) state.config.agents = {}
  const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>

  for (const agentName of AGENT_NAMES) {
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    agentsMutable[agentName].model = finalModel
  }

  state.modified = true
  s.stop(`Set model "${finalModel}" for all agents ${color.green("[OK]")}`)
}

async function setFallbackForAllAgents(state: ConfigEditorState): Promise<void> {
  const model = await p.select({
    message: "Select fallback model to set for ALL agents:",
    options: [
      ...AVAILABLE_MODELS.map((m) => ({ value: m, label: m })),
      { value: "__custom__", label: "Custom model..." },
      { value: "__back__", label: "Back" },
    ],
  })

  if (p.isCancel(model) || model === "__back__") return

  let finalModel: string
  if (model === "__custom__") {
    const custom = await p.text({
      message: "Enter custom fallback model:",
      validate: (value) => {
        if (!value.trim()) return "Model name is required"
        return undefined
      },
    })
    if (p.isCancel(custom)) return
    finalModel = custom.trim()
  } else {
    finalModel = model
  }

  const confirm = await p.confirm({
    message: `Set fallback model "${finalModel}" for all ${AGENT_NAMES.length} agents?`,
    initialValue: false,
  })

  if (p.isCancel(confirm) || !confirm) {
    p.log.info("Cancelled")
    return
  }

  const s = p.spinner()
  s.start("Applying fallback model to all agents...")

  if (!state.config.agents) state.config.agents = {}
  const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>

  for (const agentName of AGENT_NAMES) {
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    agentsMutable[agentName].fallback_model = finalModel
  }

  state.modified = true
  s.stop(`Set fallback model "${finalModel}" for all agents ${color.green("[OK]")}`)
}

async function setDefaultBashPermissions(state: ConfigEditorState): Promise<void> {
  const value = await p.select({
    message: "Select default bash permission for all agents:",
    options: [
      { value: "ask", label: "Ask", hint: "Prompt before executing bash commands" },
      { value: "allow", label: "Allow", hint: "Execute bash commands without prompting" },
      { value: "deny", label: "Deny", hint: "Block all bash commands" },
      { value: "__back__", label: "Back" },
    ],
  })

  if (p.isCancel(value) || value === "__back__") return

  const confirm = await p.confirm({
    message: `Set bash permission "${value}" for all ${AGENT_NAMES.length} agents?`,
    initialValue: false,
  })

  if (p.isCancel(confirm) || !confirm) {
    p.log.info("Cancelled")
    return
  }

  const s = p.spinner()
  s.start("Applying bash permissions to all agents...")

  if (!state.config.agents) state.config.agents = {}
  const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>

  for (const agentName of AGENT_NAMES) {
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    if (!agentsMutable[agentName].permission) agentsMutable[agentName].permission = {}
    agentsMutable[agentName].permission!.bash = value as BashPermissionValue
  }

  state.modified = true
  s.stop(`Set bash permission "${value}" for all agents ${color.green("[OK]")}`)
}

export async function runBulkOperations(state: ConfigEditorState): Promise<void> {
  while (true) {
    const action = await p.select({
      message: "Select bulk operation:",
      options: [
        { value: "model", label: "Set model for all agents" },
        { value: "fallback", label: "Set fallback for all agents" },
        { value: "permissions", label: "Set default bash permissions for all agents" },
        { value: "back", label: color.dim("← Back to main menu") },
      ],
    })

    if (p.isCancel(action) || action === "back") {
      return
    }

    if (action === "model") {
      await setModelForAllAgents(state)
    } else if (action === "fallback") {
      await setFallbackForAllAgents(state)
    } else if (action === "permissions") {
      await setDefaultBashPermissions(state)
    }
  }
}
