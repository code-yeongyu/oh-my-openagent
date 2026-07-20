export type ResidentSummary = {
  readonly task_id: string
  readonly name: string
  readonly status: string
}

/**
 * Raised when a spawn cannot be admitted: the residency cap is reached and no terminal, idle
 * resident child could be evicted to make room. Names every current resident so the caller can
 * explain why nothing was reclaimable (codex AgentLimitReached contract).
 */
export class AgentLimitReached extends Error {
  readonly max_children: number
  readonly session_id: string
  readonly residents: readonly ResidentSummary[]

  constructor(input: {
    readonly max_children: number
    readonly session_id: string
    readonly residents: readonly ResidentSummary[]
  }) {
    const named = input.residents.map((resident) => `${resident.name}(${resident.status})`).join(", ")
    super(
      `Residency cap ${input.max_children} reached for session ${input.session_id}; ` +
        `no terminal idle child is evictable. Residents: ${named || "none"}.`,
    )
    this.name = "AgentLimitReached"
    this.max_children = input.max_children
    this.session_id = input.session_id
    this.residents = input.residents
  }
}
