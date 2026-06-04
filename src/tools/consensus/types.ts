export type ConsensusToolArgs = {
  prompt: string
  count?: number
  caller_model?: string
  exclude_lineages?: string[]
}

export type ConsensusToolResult = {
  ok: boolean
  advisoryOnly: boolean
  callerLineage: string | undefined
  callerModel: string | undefined
  voters: Array<{
    lineage: string
    model: string
    status: "ok" | "error" | "timeout"
    text: string
    durationMs: number
    errorMessage?: string
  }>
  totalDurationMs: number
  guidanceForSynthesizer: string
}
