export interface ModelMetadata {
  readonly id: string
  readonly provider?: string
  readonly context?: number
  readonly output?: number
  readonly name?: string
  readonly variants?: Record<string, unknown>
  readonly limit?: {
    readonly context?: number
    readonly input?: number
    readonly output?: number
  }
  readonly modalities?: {
    readonly input?: string[]
    readonly output?: string[]
  }
  readonly capabilities?: Record<string, unknown>
  readonly reasoning?: boolean
  readonly temperature?: boolean
  readonly tool_call?: boolean
  readonly [key: string]: unknown
}

export interface ProviderCache {
  readConnectedProvidersCache(): string[] | null
  findProviderModelMetadata(providerID: string, modelID: string): ModelMetadata | undefined
}
