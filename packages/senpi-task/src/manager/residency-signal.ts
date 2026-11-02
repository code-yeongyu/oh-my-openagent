// #8396: the session-scoped residency wake behind TaskManager.residencyChanged. One repeatable
// deferred per parent session, armed lazily by the first waiter and retired when it fires, so the
// map only ever holds sessions with a live waiter.
type Deferred = { readonly promise: Promise<void>; readonly resolve: () => void }

function deferred(): Deferred {
  let resolve = (): void => undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

export class ResidencySignal {
  readonly #waiters = new Map<string, Deferred>()

  changed(parentSessionId: string): Promise<void> {
    const armed = this.#waiters.get(parentSessionId)
    if (armed !== undefined) return armed.promise
    const fresh = deferred()
    this.#waiters.set(parentSessionId, fresh)
    return fresh.promise
  }

  // A residency event whose session is unknown (the record was already deleted when the handle
  // was forgotten) wakes every armed session: a spurious re-probe is one denied startOwned, while
  // a missed wake is a run parked until an unrelated child settles.
  notify(parentSessionId: string | undefined): void {
    if (parentSessionId === undefined) {
      const all = [...this.#waiters.values()]
      this.#waiters.clear()
      for (const waiter of all) waiter.resolve()
      return
    }
    const armed = this.#waiters.get(parentSessionId)
    if (armed === undefined) return
    this.#waiters.delete(parentSessionId)
    armed.resolve()
  }
}
