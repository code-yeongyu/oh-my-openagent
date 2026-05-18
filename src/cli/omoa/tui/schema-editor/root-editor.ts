import * as p from "@clack/prompts"
import color from "picocolors"
import { loadRuntimeConfig } from "../shared"

export async function showCategoryEditor(): Promise<void> {
  const config = loadRuntimeConfig()
  if (!config) { p.log.error("Cannot load config"); return }

  const categories = config.categories ?? {}
  const catNames = Object.keys(categories)

  if (catNames.length === 0) {
    p.log.info("No categories defined in config.")
    return
  }

  const selected = await p.select({
    message: "Select category to edit:",
    options: [
      ...catNames.map((name) => ({ value: name, label: name })),
      { value: "__back__", label: color.dim("Back") },
    ],
  })

  if (p.isCancel(selected) || selected === "__back__") return

  const catName = selected as string
  const cat = categories[catName] as Record<string, unknown> ?? {}

  const fields: { key: string; label: string; type: string; hint: string }[] = [
    { key: "model", label: "Model", type: "string", hint: "" },
    { key: "description", label: "Description", type: "string", hint: "" },
    { key: "variant", label: "Variant", type: "string", hint: "" },
    { key: "temperature", label: "Temperature", type: "number", hint: "0-2" },
    { key: "top_p", label: "Top P", type: "number", hint: "0-1" },
    { key: "maxTokens", label: "Max Tokens", type: "number", hint: "" },
    { key: "reasoningEffort", label: "Reasoning Effort", type: "enum", hint: "none/minimal/low/medium/high/xhigh/max" },
    { key: "textVerbosity", label: "Text Verbosity", type: "enum", hint: "low/medium/high" },
    { key: "thinking", label: "Thinking", type: "object", hint: "extended thinking" },
    { key: "tools", label: "Tools", type: "record", hint: "enable/disable tools" },
    { key: "prompt_append", label: "Prompt Append", type: "string", hint: "" },
    { key: "max_prompt_tokens", label: "Max Prompt Tokens", type: "number", hint: "" },
    { key: "is_unstable_agent", label: "Unstable Agent", type: "boolean", hint: "" },
    { key: "disable", label: "Disable", type: "boolean", hint: "" },
  ]

  const { renderField } = await import("./field-renderer")

  while (true) {
    const field = await p.select({
      message: `Editing category "${catName}":`,
      options: [
        ...fields.map((f) => {
          const current = cat[f.key]
          return { value: f.key, label: f.label, hint: current !== undefined ? String(current) : "not set" }
        }),
        { value: "__back__", label: color.dim("Back") },
      ],
    })

    if (p.isCancel(field) || field === "__back__") return

    const fieldDef = fields.find((f) => f.key === field)!
    const result = await renderField(field as string, fieldDef, cat[field as string])

    if (result.cancelled) continue

    if (result.value === "__clear__") {
      delete cat[field as string]
      p.log.success(`Cleared ${fieldDef.label}`)
    } else if (result.value !== undefined) {
      cat[field as string] = result.value
      p.log.success(`Updated ${fieldDef.label}`)
    }
  }
}

export async function showRootEditor(): Promise<void> {
  const config = loadRuntimeConfig()
  if (!config) { p.log.error("Cannot load config"); return }

  const fields: { key: string; label: string; type: string; hint: string }[] = [
    { key: "default_run_agent", label: "Default Run Agent", type: "string", hint: "agent name for 'run' command" },
    { key: "new_task_system_enabled", label: "New Task System", type: "boolean", hint: "" },
    { key: "hashline_edit", label: "Hashline Edit", type: "boolean", hint: "" },
    { key: "model_fallback", label: "Model Fallback", type: "boolean", hint: "" },
    { key: "auto_update", label: "Auto Update", type: "boolean", hint: "" },
  ]

  const { renderField } = await import("./field-renderer")

  while (true) {
    const field = await p.select({
      message: "Edit root settings:",
      options: [
        ...fields.map((f) => {
          const current = (config as Record<string, unknown>)[f.key]
          return { value: f.key, label: f.label, hint: current !== undefined ? String(current) : "not set" }
        }),
        { value: "__back__", label: color.dim("Back") },
      ],
    })

    if (p.isCancel(field) || field === "__back__") return

    const fieldDef = fields.find((f) => f.key === field)!
    const result = await renderField(field as string, fieldDef, (config as Record<string, unknown>)[field as string])

    if (result.cancelled) continue

    if (result.value === "__clear__") {
      delete (config as Record<string, unknown>)[field as string]
      p.log.success(`Cleared ${fieldDef.label}`)
    } else if (result.value !== undefined) {
      (config as Record<string, unknown>)[field as string] = result.value
      p.log.success(`Updated ${fieldDef.label}`)
    }
  }
}
