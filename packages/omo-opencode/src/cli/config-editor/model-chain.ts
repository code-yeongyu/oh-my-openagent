import * as p from "@clack/prompts"
import { choose, record, displayText } from "./prompt"
import { selectEditorModel } from "./model-picker"
import { readEditorValue, setEditorValue, withEditorTransaction, type EditorSession } from "./session"

export type ModelEntry = string | Record<string, unknown>

export function modelId(entry: ModelEntry): string {
  return typeof entry === "string" ? entry : String(record(entry)["model"] ?? "Invalid model entry")
}

export function readModelChain(value: unknown): ModelEntry[] {
  const entry = record(value)
  if (Array.isArray(entry["models"])) return structuredClone(entry["models"]) as ModelEntry[]
  const settings = Object.fromEntries(["reasoning", "variant", "reasoningEffort", "temperature", "top_p", "maxTokens", "thinking", "max_tokens", "provider_options"]
    .filter((key) => entry[key] !== undefined).map((key) => [key, entry[key]]))
  const primary = typeof entry["model"] === "string"
    ? [Object.keys(settings).length === 0 ? entry["model"] : { model: entry["model"], ...settings }]
    : []
  const fallback = entry["fallback_models"]
  return [...primary, ...(typeof fallback === "string" ? [fallback] : Array.isArray(fallback) ? fallback : [])] as ModelEntry[]
}

export function changePrimary(chain: readonly ModelEntry[], model: string): ModelEntry[] {
  const same = chain.find((entry) => modelId(entry) === model)
  const previous = chain[0]
  const primary = same ?? (typeof previous === "object" ? { ...previous, model } : model)
  return [structuredClone(primary), ...chain.slice(1).filter((entry) => modelId(entry) !== model)]
}

export function writeModelChain(session: EditorSession, path: string[], chain: readonly ModelEntry[]): void {
  withEditorTransaction(session, (staged) => {
    setEditorValue(staged, [...path, "models"], chain.length === 0 ? undefined : chain)
    setEditorValue(staged, [...path, "model"], undefined)
    setEditorValue(staged, [...path, "fallback_models"], undefined)
  })
}

export async function editModelChain(session: EditorSession, path: string[]): Promise<void> {
  while (true) {
    const chain = readModelChain(readEditorValue(session, path))
    p.note(chain.length === 0 ? "Inherited from other layers / defaults" : chain.map((entry, index) => `${index + 1}. ${displayText(modelId(entry))}`).join("\n"), "Ordered model chain")
    const action = await choose("Model chain", [
      { value: "primary", label: "Set primary model", hint: "Keep the remaining fallbacks" },
      { value: "append", label: "Append fallback model" },
      ...(chain.length === 0 ? [] : [
        { value: "remove", label: "Remove one model" },
        { value: "promote", label: "Move a model to first" },
        { value: "inherit", label: "Clear model overrides", hint: "Inherit from other layers / defaults" },
      ]),
      { value: "back", label: "Back" },
    ])
    if (action === "back") return
    if (action === "primary" || action === "append") {
      const model = await selectEditorModel(action === "primary" && chain[0] !== undefined ? modelId(chain[0]) : undefined)
      if (model === undefined || (action === "primary" && chain[0] !== undefined && modelId(chain[0]) === model) || (action === "append" && chain.some((entry) => modelId(entry) === model))) continue
      const next = action === "primary" ? changePrimary(chain, model) : chain.some((entry) => modelId(entry) === model) ? chain : [...chain, model]
      writeModelChain(session, path, next)
    } else if (action === "inherit") {
      const confirm = await choose("Clear this entry's model overrides?", [{ value: "back", label: "Keep overrides" }, { value: "clear", label: "Clear overrides" }])
      if (confirm === "clear") writeModelChain(session, path, [])
    } else {
      const index = await choose<number>(action === "remove" ? "Remove which model?" : "Make which model primary?", [
        ...chain.map((entry, index) => ({ value: index, label: `${index + 1}. ${modelId(entry)}` })),
        { value: -1, label: "Back" },
      ])
      if (index === -1 || (action === "promote" && index === 0)) continue
      const selected = chain[index]
      const rest = chain.filter((_, position) => position !== index)
      writeModelChain(session, path, action === "remove" || selected === undefined ? rest : [selected, ...rest])
    }
  }
}
