// The engine's poll while the account event stream is down (sync-design §5): every POLL_MS it asks for a cycle,
// until the stream connects again.

import type { Clock, SyncLog } from "./ports"

export const POLL_MS = 10_000

export class PollFallback {
  private cancel: (() => void) | null = null
  private shown: string | null = null

  constructor(
    private readonly clock: Clock,
    private readonly log: SyncLog | undefined,
    private readonly onPoll: () => void,
  ) {}

  /**
   * Connected stops the poll; down starts it unless it already runs, so a stream that keeps failing its retries
   * never pushes the poll back. Each change of state or cause is logged once, which is how a slow delivery is told
   * apart from a stream that never connects (#14476).
   */
  streamChanged(connected: boolean, cause: string | undefined): void {
    const shown = connected ? "connected" : `down (${cause ?? "dropped"}), polling every ${POLL_MS / 1000} s`
    if (shown !== this.shown) {
      this.shown = shown
      this.log?.(`sync event stream ${shown}`, connected ? "info" : "warn")
    }
    if (connected) this.stop()
    else if (this.cancel === null) this.schedule()
  }

  stop(): void {
    this.cancel?.()
    this.cancel = null
  }

  private schedule(): void {
    this.cancel = this.clock.after(POLL_MS, () => {
      this.onPoll()
      this.schedule()
    })
  }
}
