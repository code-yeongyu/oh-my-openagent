import * as p from "@clack/prompts"
import color from "picocolors"
import type { AgentOverrideConfig } from "../../config/schema"
import type { ConfigEditorState, AgentName, BashPermissionValue, BashCommand } from "./types"
import { AGENT_NAMES, AVAILABLE_MODELS, BASH_COMMANDS } from "./types"

type ExtendedAgentConfig = AgentOverrideConfig & { fallback_model?: string }

const SYMBOLS = {
  check: color.green("[OK]"),
  cross: color.red("[X]"),
  arrow: color.cyan("->"),
  bullet: color.dim("*"),
  info: color.blue("[i]"),
  warn: color.yellow("[!]"),
}

function getAgentsRecord(state: ConfigEditorState): Record<string, ExtendedAgentConfig> {
  return (state.config.agents ?? {}) as Record<string, ExtendedAgentConfig>
}

function getCategoriesFromConfig(state: ConfigEditorState): string[] {
  const categories = state.config.categories ?? {}
  return Object.keys(categories)
}

function formatAgentStatus(state: ConfigEditorState, agentName: string): string {
  const agents = getAgentsRecord(state)
  const agent = agents[agentName]
  if (!agent) {
    return color.dim("not configured")
  }

  const parts: string[] = []

  if (agent.model) {
    parts.push(`model: ${color.cyan(agent.model)}`)
  }

  if (agent.category) {
    parts.push(`cat: ${color.yellow(agent.category)}`)
  }

  if (agent.fallback_model) {
    parts.push(`fallback: ${color.dim(agent.fallback_model)}`)
  }

  if (parts.length === 0) {
    return color.dim("no settings")
  }

  return parts.join(" | ")
}

async function editAgentField(
  state: ConfigEditorState,
  agentName: string
): Promise<boolean> {
  const agents = getAgentsRecord(state)
  const agent = agents[agentName] ?? {}
  const categories = getCategoriesFromConfig(state)

  const field = await p.select({
    message: `Editing "${agentName}" - Select field to edit:`,
    options: [
      { value: "model", label: "Model", hint: agent.model ? `current: ${agent.model}` : "not set" },
      { value: "category", label: "Category", hint: agent.category ? `current: ${agent.category}` : "not set" },
      { value: "fallback_model", label: "Fallback Model", hint: agent.fallback_model ? `current: ${agent.fallback_model}` : "not set" },
      { value: "permissions", label: "Permissions", hint: agent.permission ? "configured" : "not set" },
      { value: "back", label: "Back to agent list" },
    ],
  })

  if (p.isCancel(field) || field === "back") {
    return false
  }

  if (field === "model") {
    const model = await p.select({
      message: `Select model for "${agentName}":`,
      options: [
        ...AVAILABLE_MODELS.map((m) => ({ value: m, label: m })),
        { value: "__custom__", label: "Custom model..." },
        { value: "__clear__", label: "Clear model" },
      ],
      initialValue: agent.model,
    })

    if (p.isCancel(model)) return false

    let finalModel: string | undefined
    if (model === "__clear__") {
      finalModel = undefined
    } else if (model === "__custom__") {
      const custom = await p.text({
        message: "Enter custom model name:",
        initialValue: agent.model ?? "",
      })
      if (p.isCancel(custom)) return false
      finalModel = custom
    } else {
      finalModel = model
    }

    if (!state.config.agents) state.config.agents = {}
    const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    agentsMutable[agentName].model = finalModel
    state.modified = true

    p.log.success(`Updated model for "${agentName}" to ${finalModel ?? "(none)"}`)
  }

  if (field === "category") {
    const categoryOptions = [
      ...categories.map((c) => ({ value: c, label: c })),
      { value: "__custom__", label: "Custom category..." },
      { value: "__clear__", label: "Clear category" },
    ]

    const category = await p.select({
      message: `Select category for "${agentName}":`,
      options: categoryOptions,
      initialValue: agent.category,
    })

    if (p.isCancel(category)) return false

    let finalCategory: string | undefined
    if (category === "__clear__") {
      finalCategory = undefined
    } else if (category === "__custom__") {
      const custom = await p.text({
        message: "Enter custom category name:",
        initialValue: agent.category ?? "",
      })
      if (p.isCancel(custom)) return false
      finalCategory = custom
    } else {
      finalCategory = category
    }

    if (!state.config.agents) state.config.agents = {}
    const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    agentsMutable[agentName].category = finalCategory
    state.modified = true

    p.log.success(`Updated category for "${agentName}" to ${finalCategory ?? "(none)"}`)
  }

  if (field === "fallback_model") {
    const fallback = await p.select({
      message: `Select fallback model for "${agentName}":`,
      options: [
        ...AVAILABLE_MODELS.map((m) => ({ value: m, label: m })),
        { value: "__custom__", label: "Custom model..." },
        { value: "__clear__", label: "Clear fallback" },
      ],
      initialValue: agent.fallback_model,
    })

    if (p.isCancel(fallback)) return false

    let finalFallback: string | undefined
    if (fallback === "__clear__") {
      finalFallback = undefined
    } else if (fallback === "__custom__") {
      const custom = await p.text({
        message: "Enter custom fallback model:",
        initialValue: agent.fallback_model ?? "",
      })
      if (p.isCancel(custom)) return false
      finalFallback = custom
    } else {
      finalFallback = fallback
    }

    if (!state.config.agents) state.config.agents = {}
    const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    agentsMutable[agentName].fallback_model = finalFallback
    state.modified = true

    p.log.success(`Updated fallback model for "${agentName}" to ${finalFallback ?? "(none)"}`)
  }

  if (field === "permissions") {
    const permAction = await p.select({
      message: "Select permission to configure:",
      options: [
        { value: "bash", label: "Bash Permissions", hint: "rm, mv, cp, *" },
        { value: "edit", label: "Edit Permission" },
        { value: "webfetch", label: "Webfetch Permission" },
        { value: "back", label: "Back" },
      ],
    })

    if (p.isCancel(permAction) || permAction === "back") return false

    if (permAction === "bash") {
      const bashAction = await p.select({
        message: "Configure bash permissions:",
        options: [
          { value: "simple", label: "Simple (one value for all commands)", hint: "ask, allow, or deny for all" },
          { value: "detailed", label: "Detailed (per-command)", hint: "set rm, mv, cp, * separately" },
          { value: "clear", label: "Clear bash permissions" },
          { value: "back", label: "Back" },
        ],
      })

      if (p.isCancel(bashAction) || bashAction === "back") return false

      if (bashAction === "clear") {
        if (!state.config.agents) state.config.agents = {}
        const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>
        if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
        const perm = agentsMutable[agentName].permission
        if (perm) {
          const { bash: _, ...rest } = perm
          agentsMutable[agentName].permission = Object.keys(rest).length > 0 ? rest : undefined
          state.modified = true
        }
        p.log.success("Cleared bash permissions")
      } else if (bashAction === "simple") {
        const value = await p.select({
          message: "Select bash permission level:",
          options: [
            { value: "ask", label: "Ask", hint: "Prompt before executing any bash command" },
            { value: "allow", label: "Allow", hint: "Execute bash commands without prompting" },
            { value: "deny", label: "Deny", hint: "Block all bash commands" },
          ],
        })

        if (p.isCancel(value)) return false

        if (!state.config.agents) state.config.agents = {}
        const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>
        if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
        if (!agentsMutable[agentName].permission) agentsMutable[agentName].permission = {}
        agentsMutable[agentName].permission!.bash = value as BashPermissionValue
        state.modified = true

        p.log.success(`Set bash permission to "${value}"`)
      } else if (bashAction === "detailed") {
        const existingBash = agents[agentName]?.permission?.bash
        const isSimpleValue = typeof existingBash === "string"
        const currentPerms = isSimpleValue ? undefined : existingBash as Record<string, BashPermissionValue> | undefined
        const defaultValue: BashPermissionValue = isSimpleValue ? (existingBash as BashPermissionValue) : "ask"

        const newPerms: Record<string, BashPermissionValue> = {}

        for (const cmd of BASH_COMMANDS) {
          const current = currentPerms?.[cmd] ?? defaultValue
          const value = await p.select({
            message: `Permission for "${cmd}" command:`,
            options: [
              { value: "ask", label: "Ask", hint: current === "ask" ? "current" : undefined },
              { value: "allow", label: "Allow", hint: current === "allow" ? "current" : undefined },
              { value: "deny", label: "Deny", hint: current === "deny" ? "current" : undefined },
            ],
            initialValue: current,
          })

          if (p.isCancel(value)) return false
          newPerms[cmd] = value as BashPermissionValue
        }

        if (!state.config.agents) state.config.agents = {}
        const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>
        if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
        if (!agentsMutable[agentName].permission) agentsMutable[agentName].permission = {}
        agentsMutable[agentName].permission!.bash = newPerms
        state.modified = true

        p.log.success("Updated detailed bash permissions")
      }
    } else {
      const value = await p.select({
        message: `Select ${permAction} permission:`,
        options: [
          { value: "ask", label: "Ask" },
          { value: "allow", label: "Allow" },
          { value: "deny", label: "Deny" },
        ],
      })

      if (p.isCancel(value)) return false

      if (!state.config.agents) state.config.agents = {}
      const agentsMutable = state.config.agents as Record<string, ExtendedAgentConfig>
      if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
      if (!agentsMutable[agentName].permission) agentsMutable[agentName].permission = {}
      agentsMutable[agentName].permission![permAction as "edit" | "webfetch"] = value as BashPermissionValue
      state.modified = true

      p.log.success(`Updated ${permAction} permission to "${value}"`)
    }
  }

  return true
}

export async function editAgents(state: ConfigEditorState): Promise<void> {
  while (true) {
    const agentOptions = AGENT_NAMES.map((name) => ({
      value: name,
      label: `${name.padEnd(20)} ${formatAgentStatus(state, name)}`,
    }))

    const selected = await p.select({
      message: "Select an agent to configure (or choose action):",
      options: [
        ...agentOptions,
        { value: "__back__", label: color.dim("← Back to main menu") },
      ],
    })

    if (p.isCancel(selected) || selected === "__back__") {
      return
    }

    const shouldContinue = await editAgentField(state, selected as AgentName)
    if (!shouldContinue) {
      continue
    }
  }
}
