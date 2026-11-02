type PauseIntent = {
  readonly epoch: number
  readonly acknowledged: PromiseWithResolvers<void>
  readonly settled: PromiseWithResolvers<void>
}

export class PendingPauses {
  readonly #pending = new Map<string, PauseIntent>()

  begin(taskId: string, epoch: number): Promise<void> {
    const prior = this.#pending.get(taskId)
    if (prior?.epoch === epoch) return prior.settled.promise
    const intent = {
      epoch,
      acknowledged: Promise.withResolvers<void>(),
      settled: Promise.withResolvers<void>(),
    }
    this.#pending.set(taskId, intent)
    return intent.settled.promise
  }

  settlement(taskId: string, epoch: number): Promise<void> | undefined {
    const intent = this.#pending.get(taskId)
    return intent?.epoch === epoch ? intent.acknowledged.promise : undefined
  }

  acknowledge(taskId: string, epoch: number): void {
    const intent = this.#pending.get(taskId)
    if (intent?.epoch === epoch) intent.acknowledged.resolve()
  }

  settle(taskId: string, epoch: number): void {
    const intent = this.#pending.get(taskId)
    if (intent?.epoch === epoch) intent.settled.resolve()
  }

  clear(taskId: string): void {
    const intent = this.#pending.get(taskId)
    this.#pending.delete(taskId)
    intent?.acknowledged.resolve()
    intent?.settled.resolve()
  }
}
