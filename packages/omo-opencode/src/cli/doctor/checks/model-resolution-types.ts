import type { OhMyOpenCodeConfig } from "../../../config"
import type { ModelCapabilitiesDiagnostics } from "../../../shared/model-capabilities"
import type { ModelRequirement } from "../../../shared/model-requirements"

export interface AgentResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  userVariant?: string
  effectiveModel: string
  effectiveResolution: string
  capabilityDiagnostics?: ModelCapabilitiesDiagnostics
}

export interface CategoryResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  userVariant?: string
  effectiveModel: string
  effectiveResolution: string
  capabilityDiagnostics?: ModelCapabilitiesDiagnostics
  /** True when the delegate-task runtime resolved this category; userVariant is then its reasoning. */
  runtimeResolved?: boolean
  /** The runtime's error for this category: a task() spawn would fail with it. */
  runtimeError?: string
  /** The user disabled this category; the runtime removes it, so task() cannot use it. */
  disabled?: boolean
}

export interface ModelResolutionInfo {
  agents: AgentResolutionInfo[]
  categories: CategoryResolutionInfo[]
}

/** The agents/categories view of the validated plugin config the runtime resolves from. */
export type OmoConfig = Pick<OhMyOpenCodeConfig, "agents" | "categories">

/** What the delegate-task runtime resolves for a user-configured category. */
export type RuntimeCategoryResolution =
  | { model?: string; reasoning?: string; userDefined: boolean; error?: undefined; disabled?: undefined }
  | { error: string; disabled?: undefined }
  | { disabled: true; error?: undefined }

export interface AvailableModelsInfo {
  providers: string[]
  modelCount: number
  cacheExists: boolean
}
