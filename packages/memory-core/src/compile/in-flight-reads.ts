/**
 * The repository reads a cache has started and not yet finished. A session shutdown waits on `settled()` before the
 * identity directory may be removed: a git child still running there holds the directory open, which Windows
 * reports as EBUSY on the remove (#11135).
 */
export class InFlightReads {
  private readonly running = new Set<Promise<unknown>>()

  track<T>(work: () => Promise<T>): Promise<T> {
    const running = work()
    this.running.add(running)
    const forget = (): void => {
      this.running.delete(running)
    }
    running.then(forget, forget)
    return running
  }

  /** Settles once every tracked read finished, including reads a tracked read started while it ran. */
  async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.allSettled([...this.running])
  }
}
