import * as p from "@clack/prompts"
import color from "picocolors"
import { OverridableAgentNameSchema } from "../../../../config/schema/agent-names"
import { loadRuntimeConfig, saveRuntimeConfig } from "../shared"
import { hasAgentRanking, readOmoaRankings } from "../../state/rankings-manager"
import { renderField } from "./field-renderer"
import { showCategoryEditor, showRootEditor } from "./root-editor"

const CLEAR_SENTINEL = "__sentinel_clear__"

export async function showSchemaEditorMenu(): Promise<void> {
  while (true) {
    const action = await p.select({
      message: "Edit Config (schema-driven):",
      options: [
        { value: "agent", label: "Agent Overrides", hint: "Edit per-agent fields (temperature, thinking, permissions, etc.)" },
        { value: "category", label: "Categories", hint: "Edit category fields" },
        { value: "root", label: "Root Settings", hint: "Edit root config fields" },
        { value: "back", label: color.dim("Back to main menu") },
      ],
    })

    if (p.isCancel(action) || action === "back") return

    if (action === "agent") await showAgentEditor()
    if (action === "category") await showCategoryEditor()
    if (action === "root") await showRootEditor()
  }
}

async function showAgentEditor(): Promise<void> {
  const config = loadRuntimeConfig()
  if (!config) { p.log.error("Cannot load config"); return }

  const rankings = readOmoaRankings()
  const agentNames = OverridableAgentNameSchema.options
  const agents = (config.agents ?? {}) as Record<string, Record<string, unknown>>

  const agentSelection = await p.select({
    message: "Select agent to edit:",
    options: [
      ...agentNames.map((name) => ({
        value: name,
        label: `${name.padEnd(22)} ${hasAgentRanking(rankings, name) ? color.cyan("[OMOA-managed model]") : color.dim("[manual model]")}`,
      })),
      { value: "__back__", label: color.dim("Back") },
    ],
  })

  if (p.isCancel(agentSelection) || agentSelection === "__back__") return

  const agentName = agentSelection as string
  const agent: Record<string, unknown> = agents[agentName] ?? {}
  const managed = hasAgentRanking(rankings, agentName)

  await editAgentFields(config, agents, agentName, agent, managed)
}

async function editAgentFields(
  config: Record<string, unknown>,
  agents: Record<string, Record<string, unknown>>,
  agentName: string,
  agent: Record<string, unknown>,
  managed: boolean,
): Promise<void> {
  const fields: { key: string; label: string; type: string; hint: string }[] = [
    { key: "model", label: "Model", type: "string", hint: managed ? "OMOA-managed - edit via Rankings/Build" : "current model" },
    { key: "category", label: "Category", type: "string", hint: "inherit settings from category" },
    { key: "variant", label: "Variant", type: "string", hint: "reasoning variant" },
    { key: "temperature", label: "Temperature", type: "number", hint: "0-2" },
    { key: "top_p", label: "Top P", type: "number", hint: "0-1" },
    { key: "maxTokens", label: "Max Tokens", type: "number", hint: "response token limit" },
    { key: "reasoningEffort", label: "Reasoning Effort", type: "enum", hint: "none/minimal/low/medium/high/xhigh/max" },
    { key: "textVerbosity", label: "Text Verbosity", type: "enum", hint: "low/medium/high" },
    { key: "thinking", label: "Thinking", type: "object", hint: "extended thinking config" },
    { key: "permission", label: "Permissions", type: "object", hint: "bash/edit/webfetch/task/doom_loop/external_directory" },
    { key: "tools", label: "Tools", type: "record", hint: "enable/disable specific tools" },
    { key: "prompt", label: "Prompt", type: "string", hint: "custom prompt override" },
    { key: "prompt_append", label: "Prompt Append", type: "string", hint: "append to agent prompt" },
    { key: "description", label: "Description", type: "string", hint: "agent description" },
    { key: "mode", label: "Mode", type: "enum", hint: "subagent/primary/all" },
    { key: "disable", label: "Disable", type: "boolean", hint: "disable this agent" },
    { key: "color", label: "Color", type: "string", hint: "#RRGGBB" },
    { key: "skills", label: "Skills", type: "array", hint: "skill names to inject" },
    { key: "ultrawork", label: "Ultrawork", type: "object", hint: "per-message ultrawork override" },
    { key: "compaction", label: "Compaction", type: "object", hint: "compaction model/variant override" },
    { key: "providerOptions", label: "Provider Options", type: "record", hint: "provider-specific options" },
  ]

  while (true) {
    const field = await p.select({
      message: `Editing "${agentName}" - Select field:`,
      options: [
        ...fields.map((f) => {
          const current = agent[f.key]
          const currentStr = current !== undefined ? String(current) : color.dim("not set")
          const managedWarning = f.key === "model" && managed ? color.yellow(" [OMOA]") : ""
          return { value: f.key, label: `${f.label}${managedWarning}`, hint: `${currentStr}` }
        }),
        { value: "__back__", label: color.dim("Back") },
      ],
    })

    if (p.isCancel(field) || field === "__back__") return

    if (field === "model" && managed) {
      p.log.warn("This agent's model is OMOA-managed. Edit via Rankings menu or run Build. Remove ranking to manage manually.")
      continue
    }

    const fieldDef = fields.find((f) => f.key === field)!
    const result = await renderField(field as string, fieldDef, agent[field as string])

    if (result.cancelled) continue

    if (result.value === CLEAR_SENTINEL) {
      delete agent[field as string]
      p.log.success(`Cleared ${fieldDef.label} for "${agentName}"`)
    } else if (result.value !== undefined) {
      agent[field as string] = result.value
      p.log.success(`Updated ${fieldDef.label} for "${agentName}"`)
    } else {
      continue
    }

    // Persist after every mutation
    agents[agentName] = agent
    config.agents = agents
    if (!saveRuntimeConfig(config)) {
      p.log.error("Failed to save config to disk")
    }
  }
}
