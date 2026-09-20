/** Pi models.json model entry (engine `docs/models.md` Model Configuration table). */
export interface OpenferenceSenpiModelEntry {
  readonly id: string
  readonly name: string
  readonly reasoning: boolean
  readonly input: readonly string[]
  readonly contextWindow: number
  readonly maxTokens: number
  readonly cost: {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite: number
  }
  readonly thinkingLevelMap?: { readonly [level: string]: string | null }
}

export type OpenferenceSenpiCatalog = readonly OpenferenceSenpiModelEntry[]
