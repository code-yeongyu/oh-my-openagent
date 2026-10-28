import * as p from "@clack/prompts"
import { LATEST_MODEL_BY_FAMILY } from "@oh-my-opencode/model-core/latest-models"
import { displayText } from "./prompt"

import { readEditorModels, validateEditorModel, type EditorModels } from "./models"

export type EditorModelPrompts = {
  readonly select: (options: p.SelectOptions<number>) => Promise<number | symbol>
  readonly autocomplete: (options: p.AutocompleteOptions<number>) => Promise<number | symbol>
  readonly text: (options: p.TextOptions) => Promise<string | symbol>
}

type ModelPickerOptions = {
  readonly models?: EditorModels
  readonly prompts?: EditorModelPrompts
}

async function browseModels(models: EditorModels, prompts: EditorModelPrompts): Promise<string | symbol | undefined> {
  const providers = [...models.keys()]
  while (true) {
    const providerIndex = await prompts.select({
      message: "Select a cached provider",
      options: [
        ...providers.map((provider, value) => ({ value, label: provider })),
        { value: -1, label: "Back to model options" },
      ],
    })
    if (typeof providerIndex === "symbol") return providerIndex
    if (providerIndex === -1) return undefined
    const provider = providers[providerIndex]
    if (provider === undefined) continue
    const entries = models.get(provider) ?? []
    const modelIndex = await prompts.autocomplete({
      message: `Search cached models for ${provider}`,
      placeholder: "Type to filter models",
      maxItems: 10,
      options: [
        ...entries.map((model, value) => ({ value, label: model })),
        { value: -1, label: "Back to providers" },
      ],
      filter: (search, option) => option.value === -1 || (option.label ?? "").toLowerCase().includes(search.toLowerCase()),
    })
    if (typeof modelIndex === "symbol") return modelIndex
    if (modelIndex === -1) continue
    const model = entries[modelIndex]
    if (model !== undefined) return `${provider}/${model}`
  }
}

/** Cancellation returns to the caller without changing any configuration. */
export async function selectEditorModel(current?: string, options: ModelPickerOptions = {}): Promise<string | undefined> {
  const models = options.models ?? readEditorModels()
  const prompts = options.prompts ?? p
  while (true) {
    const choice = await prompts.select({
      message: "Choose a model",
      initialValue: current === undefined ? 0 : 2,
      options: [
        { value: 0, label: "Enter provider/model" },
        ...(models.size === 0 ? [] : [{ value: 1, label: "Browse cached models", hint: "Suggestions; availability is not checked" }]),
        ...(current === undefined ? [] : [{ value: 2, label: `Keep ${displayText(current)}` }]),
        { value: -1, label: "Back without changes" },
      ],
    })
    if (typeof choice === "symbol" || choice === -1) return undefined
    if (choice === 2) return current
    if (choice === 1) {
      const model = await browseModels(models, prompts)
      if (typeof model === "symbol") return undefined
      if (model !== undefined) return model
      continue
    }
    const model = await prompts.text({
      message: "Enter a model (provider/model)",
      placeholder: `openai/${LATEST_MODEL_BY_FAMILY.gptSol}`,
      ...(current === undefined ? {} : { initialValue: displayText(current) }),
      validate: validateEditorModel,
    })
    if (typeof model === "symbol") return undefined
    if (validateEditorModel(model) === undefined) return model.trim()
  }
}
