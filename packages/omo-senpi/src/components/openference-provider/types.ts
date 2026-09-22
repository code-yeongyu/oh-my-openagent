import type { ThinkingLevelMap } from "@earendil-works/pi-ai"

/**
 * Committed-catalog entry shape (Pi models.json model-entry form). The component
 * completes these into full pi-ai Model objects at registration time, filling
 * api/provider/baseUrl from the provider block.
 */
export interface OpenferenceSenpiModelEntry {
  readonly id: string
  readonly name: string
  readonly reasoning: boolean
  readonly input: readonly ("text" | "image")[]
  readonly contextWindow: number
  readonly maxTokens: number
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
  }
  readonly thinkingLevelMap?: ThinkingLevelMap
}

export type OpenferenceSenpiCatalog = readonly OpenferenceSenpiModelEntry[]
