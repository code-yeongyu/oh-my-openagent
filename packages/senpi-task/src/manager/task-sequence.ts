// Per-parent-session spawn ordinals. The ordinal is a relational key for grouping one logical
// task's runs (initial spawn, revive, respawn) and carries no task text; each session counts from
// zero so the value stays small and session-local.
export class TaskSequence {
  readonly #byParent = new Map<string, number>()
  readonly #nicknameSetsByParent = new Map<string, Map<string, number>>()

  next(parentSessionId: string): number {
    const ordinal = this.#byParent.get(parentSessionId) ?? 0
    this.#byParent.set(parentSessionId, ordinal + 1)
    return ordinal
  }

  nextNicknameOrdinal(parentSessionId: string, set: string): number {
    let sets = this.#nicknameSetsByParent.get(parentSessionId)
    if (sets === undefined) {
      sets = new Map()
      this.#nicknameSetsByParent.set(parentSessionId, sets)
    }
    const ordinal = sets.get(set) ?? 0
    sets.set(set, ordinal + 1)
    return ordinal
  }
}
