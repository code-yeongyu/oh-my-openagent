import type { CategoryConfig } from "../../config/schema"

export type BuiltinCategoryDefinition = {
  name: string
  config: CategoryConfig
  description: string
  callerGuidance?: string
  promptAppend: string
  resolvePromptAppend?: (model: string | undefined) => string
  requiresModel?: string
}
