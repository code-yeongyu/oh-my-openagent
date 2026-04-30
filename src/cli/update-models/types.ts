export type UpdateModelsMode = "preserve-custom" | "full-replacement"

export interface UpdateModelsOptions {
  directory?: string
  mode: UpdateModelsMode
  dryRun?: boolean
  json?: boolean
}

export interface UpdateModelsResult {
  updated: string[]
  preserved: string[]
  added: string[]
  backupPath?: string
}

export interface ModelMappingEntry {
  model?: string
  fallback_models?: Array<{ model: string }>
  variant?: string
}