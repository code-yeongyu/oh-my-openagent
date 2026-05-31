import * as p from "@clack/prompts"
import color from "picocolors"
import type { ConfigEditorState, AgentName, BashPermissionValue, BashCommand, AgentConfigExtended } from "./types"
import { AGENT_NAMES, BASH_COMMANDS } from "./types"
import { selectModelWithCacheLoader } from "./ui-utils"

const SYMBOLS = {
  check: color.green("[OK]"),
  cross: color.red("[X]"),
  arrow: color.cyan("->"),
  bullet: color.dim("*"),
  info: color.blue("[i]"),
  warn: color.yellow("[!]"),
}

function getAgentsRecord(state: ConfigEditorState): Record<string, AgentConfigExtended> {
  return (state.config.agents ?? {}) as Record<string, AgentConfigExtended>
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

  const fbArray = Array.isArray(agent.fallback_models) ? agent.fallback_models : agent.fallback_models ? [String(agent.fallback_models)] : []
  if (fbArray.length) {
    parts.push(`fallback: ${color.dim(fbArray[0])}${fbArray.length > 1 ? " +" + (fbArray.length - 1) : ""}`)
  }

  if (agent.permission) {
    const hasBash = agent.permission.bash !== undefined
    const hasEdit = agent.permission.edit !== undefined
    const hasWebfetch = agent.permission.webfetch !== undefined
    if (hasBash || hasEdit || hasWebfetch) {
      parts.push(`perm: ${color.green("✓")}`)
    }
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
  const fbArray = Array.isArray(agent.fallback_models) ? agent.fallback_models : agent.fallback_models ? [String(agent.fallback_models)] : []

  const field = await p.select({
    message: `Editing "${agentName}" - Select field to edit:`,
    options: [
      { value: "model", label: "Model", hint: agent.model ? `current: ${agent.model}` : "not set" },
      { value: "category", label: "Category", hint: agent.category ? `current: ${agent.category}` : "not set" },
      { value: "fallback_model", label: "Fallback Model", hint: fbArray.length ? `current: ${fbArray[0]}${fbArray.length > 1 ? " +" + (fbArray.length - 1) : ""}` : "not set" },
      { value: "permissions", label: "Permissions", hint: agent.permission ? "configured" : "not set" },
      { value: "back", label: "Back to agent list" },
    ],
  })

  if (p.isCancel(field) || field === "back") {
    return false
  }

  if (field === "model") {
    const model = await selectModelWithCacheLoader(
      `Select model for "${agentName}":`,
      agent.model
    )

    if (p.isCancel(model)) return false

    let finalModel: string | undefined
    if (model === "__clear__") {
      finalModel = undefined
    } else if (model === "__custom__") {
      const custom = await p.text({
        message: "Enter custom model name:",
        initialValue: agent.model ?? "",
        validate: (value) => {
          if (!value.trim()) return "Model name is required"
          return undefined
        },
      })
      if (p.isCancel(custom)) return false
      finalModel = custom.trim() || undefined
    } else {
      finalModel = model as string
    }

    if (!state.config.agents) state.config.agents = {}
    const agentsMutable = state.config.agents as Record<string, AgentConfigExtended>
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
    const agentsMutable = state.config.agents as Record<string, AgentConfigExtended>
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    agentsMutable[agentName].category = finalCategory
    state.modified = true

    p.log.success(`Updated category for "${agentName}" to ${finalCategory ?? "(none)"}`)
  }

  if (field === "fallback_model") {
    const fallbackArray = Array.isArray(agent.fallback_models) 
      ? agent.fallback_models 
      : agent.fallback_models 
        ? [String(agent.fallback_models)] 
        : []
    const currentFallback = fallbackArray[0]
    const model = await selectModelWithCacheLoader(
      `Select fallback model for "${agentName}":`,
      currentFallback
    )

    if (p.isCancel(model)) return false

    let finalFallback: string | undefined
    if (model === "__clear__") {
      finalFallback = undefined
    } else if (model === "__custom__") {
      const custom = await p.text({
        message: "Enter custom fallback model:",
        initialValue: currentFallback ?? "",
      })
      if (p.isCancel(custom)) return false
      finalFallback = custom
    } else {
      finalFallback = model as string
    }

    if (!state.config.agents) state.config.agents = {}
    const agentsMutable = state.config.agents as Record<string, AgentConfigExtended>
    if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
    const existingFallbacks = fallbackArray.slice(1)
    if (finalFallback) {
      const filtered = existingFallbacks.filter(f => f !== finalFallback)
      agentsMutable[agentName].fallback_models = [finalFallback, ...filtered]
    } else if (existingFallbacks.length > 0) {
      agentsMutable[agentName].fallback_models = existingFallbacks
    } else {
      delete agentsMutable[agentName].fallback_models
    }
    state.modified = true

    p.log.success(`Updated fallback model for "${agentName}" to ${finalFallback ?? "(none)"}`)
  }

  if (field === "permissions") {
    const existingPerm = agent.permission
    const hasBash = existingPerm?.bash !== undefined
    const hasEdit = existingPerm?.edit !== undefined
    const hasWebfetch = existingPerm?.webfetch !== undefined

    const permAction = await p.select({
      message: "Select permission to configure:",
      options: [
        { value: "bash", label: "Bash Permissions", hint: hasBash ? "configured" : "rm, mv, cp, *" },
        { value: "edit", label: "Edit Permission", hint: hasEdit ? "configured" : "not set" },
        { value: "webfetch", label: "Webfetch Permission", hint: hasWebfetch ? "configured" : "not set" },
        { value: "back", label: "Back" },
      ],
    })

    if (p.isCancel(permAction) || permAction === "back") return false

    if (permAction === "bash") {
      const existingBash = existingPerm?.bash
      const isSimple = typeof existingBash === "string"
      const bashHint = isSimple ? `current: ${existingBash}` : (typeof existingBash === "object" ? "current: detailed" : "not set")

      const bashAction = await p.select({
        message: "Configure bash permissions:",
        options: [
          { value: "simple", label: "Simple (one value for all commands)", hint: isSimple ? `current: ${existingBash}` : "ask, allow, or deny for all" },
          { value: "detailed", label: "Detailed (per-command)", hint: !isSimple && existingBash ? "current: detailed" : "set rm, mv, cp, * separately" },
          { value: "clear", label: "Clear bash permissions", hint: hasBash ? "configured" : undefined },
          { value: "back", label: "Back" },
        ],
      })

      if (p.isCancel(bashAction) || bashAction === "back") return false

      if (bashAction === "clear") {
        if (!state.config.agents) state.config.agents = {}
        const agentsMutable = state.config.agents as Record<string, AgentConfigExtended>
        if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
        const perm = agentsMutable[agentName].permission
        if (perm) {
          const { bash: _, ...rest } = perm
          agentsMutable[agentName].permission = Object.keys(rest).length > 0 ? rest : undefined
          state.modified = true
        }
        p.log.success("Cleared bash permissions")
      } else if (bashAction === "simple") {
        const currentSimple = typeof existingBash === "string" ? existingBash : undefined
        const value = await p.select({
          message: "Select bash permission level:",
          options: [
            { value: "ask", label: "Ask", hint: currentSimple === "ask" ? "current" : "Prompt before executing any bash command" },
            { value: "allow", label: "Allow", hint: currentSimple === "allow" ? "current" : "Execute bash commands without prompting" },
            { value: "deny", label: "Deny", hint: currentSimple === "deny" ? "current" : "Block all bash commands" },
          ],
          initialValue: currentSimple ?? "ask",
        })

        if (p.isCancel(value)) return false

        if (!state.config.agents) state.config.agents = {}
        const agentsMutable = state.config.agents as Record<string, AgentConfigExtended>
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

        const newPerms: Record<string, BashPermissionValue> = { ...currentPerms }

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
        const agentsMutable = state.config.agents as Record<string, AgentConfigExtended>
        if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
        if (!agentsMutable[agentName].permission) agentsMutable[agentName].permission = {}
        agentsMutable[agentName].permission!.bash = newPerms
        state.modified = true

        p.log.success("Updated detailed bash permissions")
      }
    } else {
      const currentPerm = existingPerm?.[permAction as "edit" | "webfetch"]
      const value = await p.select({
        message: `Select ${permAction} permission:`,
        options: [
          { value: "ask", label: "Ask", hint: currentPerm === "ask" ? "current" : undefined },
          { value: "allow", label: "Allow", hint: currentPerm === "allow" ? "current" : undefined },
          { value: "deny", label: "Deny", hint: currentPerm === "deny" ? "current" : undefined },
          { value: "__clear__", label: color.red("Clear permission"), hint: currentPerm ? "remove override" : undefined },
        ],
        initialValue: currentPerm ?? "ask",
      })

      if (p.isCancel(value)) return false

      if (!state.config.agents) state.config.agents = {}
      const agentsMutable = state.config.agents as Record<string, AgentConfigExtended>
      if (!agentsMutable[agentName]) agentsMutable[agentName] = {}
      if (!agentsMutable[agentName].permission) agentsMutable[agentName].permission = {}

      if (value === "__clear__") {
        delete agentsMutable[agentName].permission![permAction as "edit" | "webfetch"]
        if (Object.keys(agentsMutable[agentName].permission!).length === 0) {
          delete agentsMutable[agentName].permission
        }
        p.log.success(`Cleared ${permAction} permission`)
      } else {
        agentsMutable[agentName].permission![permAction as "edit" | "webfetch"] = value as BashPermissionValue
        p.log.success(`Updated ${permAction} permission to "${value}"`)
      }
      state.modified = true
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
