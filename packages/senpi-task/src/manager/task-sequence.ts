// Per-parent-session spawn ordinals. The ordinal is a relational key for grouping one logical
// task's runs (initial spawn, revive, respawn) and carries no task text; each session counts from
// zero so the value stays small and session-local.
export class TaskSequence {
  readonly #byParent = new Map<string, number>()

  next(parentSessionId: string): number {
    const ordinal = this.#byParent.get(parentSessionId) ?? 0
    this.#byParent.set(parentSessionId, ordinal + 1)
    return ordinal
  }
}
