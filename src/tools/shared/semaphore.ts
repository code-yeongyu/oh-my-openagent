/**
 * Simple counting semaphore to limit concurrent process execution.
 * Used to prevent multiple ripgrep processes from saturating CPU.
 */
export class Semaphore {
  private queue: (() => void)[] = []
  private running = 0

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.max) {
      this.running++
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++
        resolve()
      })
    })
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) next()
  }
}

/** Global semaphore limiting concurrent ripgrep processes to 2 */
export const rgSemaphore = new Semaphore(2)
