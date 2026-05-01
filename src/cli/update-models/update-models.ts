import { loadPluginConfig } from "../../plugin-config.js"
import { detectCurrentConfig } from "../config-manager/detect-current-config.js"
import { generateModelConfig } from "../model-fallback.js"
import { backupConfigFile } from "../config-manager/backup-config.js"
import { compareMappings } from "./compare-mappings.js"
import type { UpdateModelsOptions, UpdateModelsResult, ModelMappingEntry } from "./types.js"
import type { InstallConfig } from "../types.js"
import type { GeneratedOmoConfig } from "../model-fallback-types.js"
import { readFileSync, writeFileSync, renameSync, existsSync } from "fs"
import { join } from "path"

export interface UpdateModelsDeps {
  loadConfig?: (directory: string) => Record<string, unknown> | null
  detectCurrentConfig?: () => InstallConfig
  generateModelConfig?: (config: InstallConfig) => GeneratedOmoConfig
  compareMappings?: typeof compareMappings
  backupConfigFile?: (configPath: string) => { success: boolean; backupPath?: string }
  writeFile?: (path: string, content: string) => void
  readFile?: (path: string) => string
  existsFile?: (path: string) => boolean
  renameFile?: (oldPath: string, newPath: string) => void
}

export async function updateModels(
  options: UpdateModelsOptions,
  deps: UpdateModelsDeps = {}
): Promise<UpdateModelsResult> {
  const {
    loadConfig = loadExistingConfig,
    detectCurrentConfig: detect = detectCurrentConfig,
    generateModelConfig: generate = generateModelConfig,
    compareMappings: compare = compareMappings,
    backupConfigFile: backup = backupConfigFile,
    writeFile = writeFileSync,
    readFile = readFileSync,
    existsFile = existsSync,
    renameFile = renameSync,
  } = deps

  const directory = options.directory ?? process.cwd()
  const configPath = join(directory, "oh-my-openagent.json")

  // Load existing config
  const existingConfig = loadConfig(directory)
  if (!existingConfig) {
    return {
      success: false,
      message: "No oh-my-openagent.json found. Run `oh-my-opencode install` first.",
      updated: [],
      preserved: [],
      added: [],
    }
  }

  // Detect providers from existing config
  const providerConfig = detect(directory)

  // Generate new defaults based on detected providers
  const generatedConfig = generate(providerConfig)

  // Extract current mappings from existing config
  const currentAgents = (existingConfig.agents as Record<string, ModelMappingEntry>) || {}
  const currentCategories = (existingConfig.categories as Record<string, ModelMappingEntry>) || {}

  const generatedAgents = generatedConfig.agents || {}
  const generatedCategories = generatedConfig.categories || {}

  // Compare and determine what to update
  const agentsComparison = compare(currentAgents, generatedAgents as Record<string, ModelMappingEntry>)
  const categoriesComparison = compare(currentCategories, generatedCategories as Record<string, ModelMappingEntry>)

  const updated: string[] = []
  const preserved: string[] = []
  const added: string[] = []

  // Build new config based on mode
  let newAgents: Record<string, ModelMappingEntry>
  let newCategories: Record<string, ModelMappingEntry>

  if (options.mode === "full-replacement") {
    // Merge generated model properties INTO existing entries to preserve non-model properties
    newAgents = { ...currentAgents }
    newCategories = { ...currentCategories }

    for (const [key, value] of Object.entries(generatedAgents)) {
      newAgents[key] = { ...currentAgents[key], ...value }
      updated.push(`agents.${key}`)
    }

    for (const [key, value] of Object.entries(generatedCategories)) {
      newCategories[key] = { ...currentCategories[key], ...value }
      updated.push(`categories.${key}`)
    }
  } else {
    newAgents = { ...currentAgents }
    newCategories = { ...currentCategories }

    for (const key of Object.keys(agentsComparison.toUpdate)) {
      preserved.push(`agents.${key}`)
    }

    for (const key of agentsComparison.toPreserve) {
      preserved.push(`agents.${key}`)
    }

    for (const [key, value] of Object.entries(agentsComparison.toAdd)) {
      newAgents[key] = value
      added.push(`agents.${key}`)
    }

    for (const key of Object.keys(categoriesComparison.toUpdate)) {
      preserved.push(`categories.${key}`)
    }

    for (const key of categoriesComparison.toPreserve) {
      preserved.push(`categories.${key}`)
    }

    for (const [key, value] of Object.entries(categoriesComparison.toAdd)) {
      newCategories[key] = value
      added.push(`categories.${key}`)
    }
  }

  // If dry run, just return what would change
  if (options.dryRun) {
    const result: UpdateModelsResult = {
      success: true,
      message: `Dry run: ${updated.length} entries would be updated, ${preserved.length} preserved, ${added.length} added`,
      updated,
      preserved,
      added,
    }

    if (options.json) {
      console.log(JSON.stringify(result, null, 2))
    }

    return result
  }

  // Create backup before writing
  let backupPath: string | undefined
  if (existsFile(configPath)) {
    const backupResult = backup(configPath)
    if (backupResult.success && backupResult.backupPath) {
      backupPath = backupResult.backupPath
    }
  }

  // Build new config preserving non-model properties
  const newConfig = {
    ...existingConfig,
    agents: newAgents,
    categories: newCategories,
  }

  // Atomic write: write to temp file then rename
  const tempPath = `${configPath}.tmp`
  writeFile(tempPath, JSON.stringify(newConfig, null, 2) + "\n")
  renameFile(tempPath, configPath)

  const result: UpdateModelsResult = {
    success: true,
    message: `Updated ${updated.length} entries, preserved ${preserved.length}, added ${added.length}`,
    updated,
    preserved,
    added,
    backupPath,
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    console.log(result.message)
    if (backupPath) {
      console.log(`Backup created: ${backupPath}`)
    }
  }

  return result
}

function loadExistingConfig(directory: string): Record<string, unknown> | null {
  const configPath = join(directory, "oh-my-openagent.json")
  try {
    if (!existsSync(configPath)) {
      return null
    }
    const content = readFileSync(configPath, "utf-8")
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

export default updateModels
