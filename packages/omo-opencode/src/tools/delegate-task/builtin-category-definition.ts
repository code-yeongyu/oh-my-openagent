import type { CategoryConfig } from "../../config/schema"

export type BuiltinCategoryDefinition = {
  name: string
  config: CategoryConfig
  description: string
  callerGuidance?: string
  promptAppend: string
  resolvePromptAppend?: (model: string | undefined) => string
  // One model id, or several ids any one of which satisfies the gate (see builtin-categories.ts).
  requiresModel?: string | readonly string[]
}
