import type { OmoConfigEnv, OmoConfigSourceScope } from "@oh-my-opencode/omo-config-core"

export type ConfigModelsOptions = {
  readonly directory?: string
  readonly environment?: OmoConfigEnv
  readonly json?: boolean
  readonly output?: (line: string) => void
}

export type ModelMapEntry = string | {
  readonly model: string
  readonly reasoning?: string
  readonly variant?: string
  readonly reasoningEffort?: string
}

export type ModelDeclaration = {
  readonly section: "agents" | "categories"
  readonly name: string
  readonly key: string
  readonly category?: string
  readonly model?: string
  readonly models?: readonly ModelMapEntry[]
  readonly fallback_models?: string | readonly ModelMapEntry[]
  readonly reasoning?: string
  readonly variant?: string
  readonly reasoningEffort?: string
  readonly disable?: boolean
}

export type ModelMapDiagnostic = {
  readonly kind: string
  readonly severity: "error" | "warning"
  readonly scope: "source" | "merged"
  readonly path: string | null
  readonly issuePaths: readonly string[]
  readonly message: string
}

export type ModelMapSource = {
  readonly path: string
  readonly scope: OmoConfigSourceScope
  readonly status: "loaded" | "partial" | "rejected" | "missing"
}

export type ModelMapView = {
  readonly path: string
  readonly scope: OmoConfigSourceScope
  readonly keyPrefix: string
  readonly declarations: readonly ModelDeclaration[]
}

export type ConfigModelsReport = {
  readonly directory: string
  readonly profile: string | null
  readonly valid: boolean
  readonly sources: readonly ModelMapSource[]
  readonly views: readonly ModelMapView[]
  readonly diagnostics: readonly ModelMapDiagnostic[]
}
