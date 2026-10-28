import * as p from "@clack/prompts"
import { OmoConfigLayerSchema, OmoConfigProfileSchema, OmoTypedHarnessConfigSchema, OmoAgentDefSchema, OmoCategoryConfigObjectSchema } from "@oh-my-opencode/omo-config-core"
import { OhMyOpenCodeConfigSchema } from "../../config"
import { AgentOverrideConfigSchema } from "../../config/schema/agent-overrides"
import { OverridableAgentNameSchema } from "../../config/schema/agent-names"
import { CategoryConfigSchema } from "../../config/schema/categories"
import { DEFAULT_CATEGORIES } from "../../tools/delegate-task/builtin-categories"
import { choose, input, record, safeName, displayText } from "./prompt"
import { editModelChain, readModelChain, modelId, changePrimary, writeModelChain } from "./model-chain"
import { selectEditorModel } from "./model-picker"
import { readEditorValue, setEditorValue, withEditorTransaction, type EditorSession } from "./session"

export function isOpenCodeView(path: readonly string[]): boolean {
  return path.at(-1) === "[opencode]"
}

function fieldNames(path: readonly string[]): string[] {
  if (path.at(-2) === "agents") return Object.keys(path.includes("[opencode]") ? AgentOverrideConfigSchema.shape : OmoAgentDefSchema.out.shape)
  if (path.at(-2) === "categories") return Object.keys(path.includes("[opencode]") ? CategoryConfigSchema.shape : OmoCategoryConfigObjectSchema.shape)
  if (isOpenCodeView(path)) return Object.keys(OhMyOpenCodeConfigSchema.shape)
  return Object.keys(path.some((part) => part.startsWith("[")) ? OmoTypedHarnessConfigSchema.shape : path[0] === "profiles" ? OmoConfigProfileSchema.shape : OmoConfigLayerSchema.shape)
}

export async function editJsonField(session: EditorSession, parent: string[], suppliedField?: string): Promise<void> {
  const fields = [...new Set([...fieldNames(parent), ...Object.keys(record(readEditorValue(session, parent)))])].sort()
  const selection = suppliedField === undefined ? await choose<number>("Choose a configuration field", [
    ...fields.map((field, value) => ({ value, label: field })),
    { value: -1, label: "Back" },
  ]) : -1
  const field = suppliedField ?? fields[selection]
  if (field === undefined) return
  const path = [...parent, field]
  const current = readEditorValue(session, path)
  const action = await choose("Edit field", [
    { value: "value", label: "Set JSON value", hint: "Strings need quotes; objects and arrays are supported" },
    { value: "inherit", label: "Remove override", hint: "Inherit from other layers / defaults" },
    { value: "back", label: "Back" },
  ])
  if (action === "back") return
  if (action === "inherit") {
    setEditorValue(session, path, undefined)
    return
  }
  const text = await input(`JSON value for ${field}`, JSON.stringify(current), (value) => {
    try {
      const candidate: EditorSession = { ...session, config: structuredClone(session.config), edits: [...session.edits] }
      setEditorValue(candidate, path, JSON.parse(value))
      return undefined
    } catch (error) { return displayText(error instanceof Error ? error.message : "Enter a valid JSON value.") }
  })
  setEditorValue(session, path, JSON.parse(text))
}

async function editTextField(session: EditorSession, path: string[], label: string): Promise<void> {
  const current = readEditorValue(session, path)
  const action = await choose(`${label}: ${typeof current === "string" ? current : "inherited"}`, [
    { value: "set", label: `Set ${label.toLowerCase()}` },
    { value: "inherit", label: "Remove override" },
    { value: "back", label: "Back" },
  ])
  if (action === "back") return
  if (action === "inherit") { setEditorValue(session, path, undefined); return }
  const value = await input(label, typeof current === "string" ? current : undefined, (text) => text.trim() ? undefined : "Enter a value or choose Remove override.")
  setEditorValue(session, path, value)
}

export async function editRootDefault(session: EditorSession, view: string[]): Promise<void> {
  await editTextField(session, [...view, "default_run_agent"], "Default run agent")
}

async function editEntry(session: EditorSession, view: string[], section: "agents" | "categories", name: string): Promise<void> {
  const path = [...view, section, name]
  while (true) {
    const chain = readModelChain(readEditorValue(session, path))
    const action = await choose(`${section === "agents" ? "Agent" : "Category"}: ${name}`, [
      { value: "models", label: "Models and fallbacks", hint: chain.length === 0 ? "inherited" : chain.map(modelId).join(" → ") },
      ...(section === "agents" && isOpenCodeView(view) ? [{ value: "category", label: "Category" }] : []),
      ...(section === "agents" ? [{ value: "permission", label: "Permissions", hint: "JSON object; individual commands supported" }] : []),
      { value: "description", label: "Description" },
      { value: "field", label: "Other configuration fields" },
      { value: "back", label: "Back" },
    ])
    if (action === "back") return
    if (action === "models") await editModelChain(session, path)
    else if (action === "category") {
      const categories = [...new Set([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(record(readEditorValue(session, [...view, "categories"])))])].sort()
      const index = await choose<number>("Inherit from category", [
        ...categories.map((category, value) => ({ value, label: category })),
        { value: -2, label: "Custom category name" },
        { value: -1, label: "Remove category override" },
        { value: -3, label: "Back" },
      ])
      if (index === -3) continue
      const category = index === -2 ? await input("Category name", undefined, safeName) : categories[index]
      setEditorValue(session, [...path, "category"], category)
    } else if (action === "description") await editTextField(session, [...path, "description"], "Description")
    else await editJsonField(session, path, action === "permission" ? "permission" : undefined)
  }
}

export async function editEntries(session: EditorSession, view: string[], section: "agents" | "categories"): Promise<void> {
  while (true) {
    const names = [...new Set([
      ...(section === "agents" ? OverridableAgentNameSchema.options : Object.keys(DEFAULT_CATEGORIES)),
      ...Object.keys(record(readEditorValue(session, [...view, section]))),
    ])].sort()
    const index = await choose<number>(`Choose ${section === "agents" ? "an agent" : "a category"}`, [
      ...names.map((name, value) => ({ value, label: name, hint: readEditorValue(session, [...view, section, name]) === undefined ? "no override in this file/view" : "configured" })),
      { value: -2, label: `New ${section === "agents" ? "agent" : "category"}` },
      { value: -1, label: "Back" },
    ])
    if (index === -1) return
    const name = index === -2 ? await input("Name", undefined, safeName) : names[index]
    if (name !== undefined) await editEntry(session, view, section, name)
  }
}

export async function bulkSetModels(session: EditorSession, view: string[]): Promise<void> {
  const section = await choose("Bulk primary model assignment", [{ value: "agents", label: "Agents" }, { value: "categories", label: "Categories" }, { value: "back", label: "Back" }])
  if (section === "back") return
  const entries = Object.keys(record(readEditorValue(session, [...view, section])))
  if (entries.length === 0) { p.log.info("No configured entries in this file/view. Create an entry first."); return }
  const selected = await p.multiselect({ message: "Select entries to update", options: entries.map((value) => ({ value, label: displayText(value) })), required: true })
  if (p.isCancel(selected)) return
  const model = await selectEditorModel()
  if (model === undefined) return
  const confirm = await choose(`Set primary model to ${model} for ${selected.length} ${section}?`, [{ value: "back", label: "Keep current models" }, { value: "apply", label: "Apply to selected entries" }])
  if (confirm === "back") return
  withEditorTransaction(session, (staged) => {
    for (const name of selected) {
      const path = [...view, section, name]
      const chain = readModelChain(readEditorValue(staged, path))
      if (chain[0] !== undefined && modelId(chain[0]) === model) continue
      writeModelChain(staged, path, changePrimary(chain, model))
    }
  })
}
