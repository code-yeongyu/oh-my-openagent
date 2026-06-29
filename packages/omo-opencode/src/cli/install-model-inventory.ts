import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { AgentConfig, CategoryConfig, GeneratedOmoConfig } from "./model-fallback-types"

const execFileAsync = promisify(execFile)

export type ModelInventory = {
  readonly availableModels: ReadonlySet<string>
}

export type ModelInventoryResult =
  | { readonly kind: "available"; readonly inventory: ModelInventory }
  | { readonly kind: "unavailable"; readonly warning: string }

export type OpenCodeModelInventoryCommand = () => Promise<string>

export function createModelInventory(models: readonly string[]): ModelInventory {
  return { availableModels: new Set(models) }
}

export function modelInventoryHas(inventory: ModelInventory | undefined, model: string): boolean {
  return inventory === undefined || inventory.availableModels.has(model)
}

export async function resolveOpenCodeInstallModelInventory(input: {
  readonly command?: OpenCodeModelInventoryCommand
} = {}): Promise<ModelInventoryResult> {
  try {
    const output = await (input.command ?? runOpenCodeModelsCommand)()
    const inventory = createModelInventory(parseOpenCodeModelLines(output))
    if (inventory.availableModels.size === 0) {
      return { kind: "unavailable", warning: "OpenCode model inventory returned no models; using static model fallback chains." }
    }
    return { kind: "available", inventory }
  } catch (error) {
    if (error instanceof Error) {
      return { kind: "unavailable", warning: `OpenCode model inventory unavailable (${error.message}); using static model fallback chains.` }
    }
    throw error
  }
}

export function filterGeneratedConfigByInventory(config: GeneratedOmoConfig, inventory: ModelInventory): GeneratedOmoConfig {
  return {
    ...config,
    agents: filterAgentRecord(config.agents, inventory),
    categories: filterCategoryRecord(config.categories, inventory),
  }
}

function parseOpenCodeModelLines(output: string): readonly string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("/"))
}

async function runOpenCodeModelsCommand(): Promise<string> {
  const result = await execFileAsync("opencode", ["models", "--pure"], {
    encoding: "utf8",
    windowsHide: true,
  })
  return result.stdout
}

function filterAgentRecord(record: Record<string, AgentConfig> | undefined, inventory: ModelInventory): Record<string, AgentConfig> | undefined {
  if (record === undefined) return undefined
  const next: Record<string, AgentConfig> = {}
  for (const [name, entry] of Object.entries(record)) {
    const selected = selectEntry(entry, inventory)
    if (selected !== null) next[name] = selected
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function filterCategoryRecord(record: Record<string, CategoryConfig> | undefined, inventory: ModelInventory): Record<string, CategoryConfig> | undefined {
  if (record === undefined) return undefined
  const next: Record<string, CategoryConfig> = {}
  for (const [name, entry] of Object.entries(record)) {
    const selected = selectEntry(entry, inventory)
    if (selected !== null) next[name] = selected
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function selectEntry(entry: AgentConfig | CategoryConfig, inventory: ModelInventory): AgentConfig | null {
  const candidates = [entry, ...(entry.fallback_models ?? [])]
  const selectedIndex = candidates.findIndex((candidate) => modelInventoryHas(inventory, candidate.model))
  if (selectedIndex === -1) return null
  const selected = candidates[selectedIndex]
  if (selected === undefined) return null
  const fallbackModels = candidates
    .slice(selectedIndex + 1)
    .filter((candidate) => modelInventoryHas(inventory, candidate.model))
  return {
    model: selected.model,
    ...(selected.variant ? { variant: selected.variant } : {}),
    ...(fallbackModels.length > 0 ? { fallback_models: fallbackModels } : {}),
  }
}
