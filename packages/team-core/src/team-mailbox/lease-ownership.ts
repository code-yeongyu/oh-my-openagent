export class InboxLeaseOwnership {
  private accepting = true
  private admittedChildren = 0
  private drainPromise: Promise<void> | null = null
  private resolveDrain: (() => void) | null = null

  tryRun<T>(activeScope: boolean, fn: () => Promise<T>): Promise<T> | null {
    if (!activeScope) return null

    this.admittedChildren += 1
    return this.runAdmitted(fn)
  }

  async closeAndDrain(): Promise<void> {
    this.accepting = false
    if (this.admittedChildren === 0) return

    this.drainPromise ??= new Promise<void>((resolve) => {
      this.resolveDrain = resolve
    })
    await this.drainPromise
  }

  private async runAdmitted<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } finally {
      this.admittedChildren -= 1
      if (!this.accepting && this.admittedChildren === 0) {
        this.resolveDrain?.()
      }
    }
  }
}
