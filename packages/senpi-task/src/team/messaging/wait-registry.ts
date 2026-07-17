export type WaitMessage = {
  readonly from: string
}

export type WaitFilter = {
  readonly from?: string
}

export type WaitRegistration<TMessage extends WaitMessage> = {
  readonly promise: Promise<TMessage>
  cancel(reason?: unknown): boolean
}

export type WaitClaim<TMessage extends WaitMessage> = {
  readonly message: TMessage
  isActive(): boolean
  resolve(): boolean
  abandon(): boolean
}

type WaitState = "waiting" | "claimed" | "settled" | "cancelled"

type WaitEntry<TMessage extends WaitMessage> = {
  readonly teamRunId: string | undefined
  readonly filter: WaitFilter
  readonly resolvePromise: (message: TMessage) => void
  readonly rejectPromise: (reason: unknown) => void
  state: WaitState
}

export class WaitRegistry<TMessage extends WaitMessage = WaitMessage> {
  readonly #entries: WaitEntry<TMessage>[] = []

  get size(): number {
    return this.#entries.filter((entry) => entry.state === "waiting" || entry.state === "claimed").length
  }

  register(filter?: WaitFilter): WaitRegistration<TMessage>
  register(teamRunId: string, filter?: WaitFilter): WaitRegistration<TMessage>
  register(teamRunIdOrFilter: string | WaitFilter = {}, filter: WaitFilter = {}): WaitRegistration<TMessage> {
    const teamRunId = typeof teamRunIdOrFilter === "string" ? teamRunIdOrFilter : undefined
    const resolvedFilter = typeof teamRunIdOrFilter === "string" ? filter : teamRunIdOrFilter
    let resolvePromise: (message: TMessage) => void = () => undefined
    let rejectPromise: (reason: unknown) => void = () => undefined
    const promise = new Promise<TMessage>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    const entry: WaitEntry<TMessage> = { teamRunId, filter: resolvedFilter, resolvePromise, rejectPromise, state: "waiting" }
    this.#entries.push(entry)

    return {
      promise,
      cancel: (reason?: unknown) => this.#cancel(entry, reason),
    }
  }

  takeMatch(message: TMessage): WaitClaim<TMessage> | undefined
  takeMatch(teamRunId: string, message: TMessage): WaitClaim<TMessage> | undefined
  takeMatch(teamRunIdOrMessage: string | TMessage, candidateMessage?: TMessage): WaitClaim<TMessage> | undefined {
    const teamRunId = typeof teamRunIdOrMessage === "string" ? teamRunIdOrMessage : undefined
    const message = typeof teamRunIdOrMessage === "string" ? candidateMessage : teamRunIdOrMessage
    if (message === undefined) return undefined
    const entry = this.#entries.find((candidate) => (
      candidate.state === "waiting"
      && candidate.teamRunId === teamRunId
      && (candidate.filter.from === undefined || candidate.filter.from === message.from)
    ))
    if (entry === undefined) return undefined
    entry.state = "claimed"

    return {
      message,
      isActive: () => entry.state === "claimed",
      resolve: () => this.#resolve(entry, message),
      abandon: () => this.#abandon(entry),
    }
  }

  cancelAll(reason: unknown): void {
    for (const entry of [...this.#entries]) {
      if (entry.state !== "waiting" && entry.state !== "claimed") continue
      entry.state = "cancelled"
      this.#remove(entry)
      entry.rejectPromise(reason)
    }
  }

  #resolve(entry: WaitEntry<TMessage>, message: TMessage): boolean {
    if (entry.state !== "claimed") return false
    entry.state = "settled"
    this.#remove(entry)
    entry.resolvePromise(message)
    return true
  }

  #abandon(entry: WaitEntry<TMessage>): boolean {
    if (entry.state !== "claimed") return false
    entry.state = "waiting"
    return true
  }

  #cancel(entry: WaitEntry<TMessage>, reason: unknown): boolean {
    if (entry.state !== "waiting" && entry.state !== "claimed") return false
    entry.state = "cancelled"
    this.#remove(entry)
    if (reason !== undefined) entry.rejectPromise(reason)
    return true
  }

  #remove(entry: WaitEntry<TMessage>): void {
    const index = this.#entries.indexOf(entry)
    if (index >= 0) this.#entries.splice(index, 1)
  }
}
