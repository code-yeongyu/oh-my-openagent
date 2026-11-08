export type DesignatedChainNotHeldReason = "unsupported" | "refused" | "timeout"

/**
 * A child's engine did not take its designated model chain, so the child is never prompted (#12759).
 * `models` comes from the child's own spec (omo-computed), never from engine output; the engine's own
 * refusal text stays in `message` only, which the start-failure description never copies.
 */
export class DesignatedChainNotHeldError extends Error {
  override readonly name = "DesignatedChainNotHeldError"
  readonly reason: DesignatedChainNotHeldReason
  readonly models: readonly string[]

  constructor(input: {
    readonly message: string
    readonly reason: DesignatedChainNotHeldReason
    readonly models: readonly string[]
  }) {
    super(input.message)
    this.reason = input.reason
    this.models = [...input.models]
  }
}
