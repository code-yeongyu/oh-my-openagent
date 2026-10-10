/**
 * Cancels waiting for a child's lost connection (omo#9403). While one is pending only the cancel may
 * end that run; its settlement is what the outcome tracker waits on before it writes anything.
 */
export class PendingStops {
  readonly #pending = new Map<string, PromiseWithResolvers<void>>()

  request(taskId: string): void {
    if (!this.#pending.has(taskId)) this.#pending.set(taskId, Promise.withResolvers<void>())
  }

  settlement(taskId: string): Promise<void> | undefined {
    return this.#pending.get(taskId)?.promise
  }

  settle(taskId: string): void {
    const pending = this.#pending.get(taskId)
    this.#pending.delete(taskId)
    pending?.resolve()
  }
}
