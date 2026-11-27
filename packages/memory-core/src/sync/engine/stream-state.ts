// Where the account event stream stands for one engine, and the poll that stands in while it is down (#14476). Each
// change of state or cause is logged once, which is how a slow delivery is told apart from a stream that never
// connects; a stream that keeps failing its retries never pushes the poll back.

import type { EngineTimers } from "./engine-timers"
import type { SyncLog } from "./ports"

export class StreamState {
  up = false
  private shown: string | null = null

  constructor(
    private readonly timers: EngineTimers,
    private readonly log: SyncLog | undefined,
    private readonly onPoll: () => void,
    private readonly pollMs: number,
  ) {}

  changed(connected: boolean, cause: string | undefined): void {
    this.up = connected
    const shown = connected ? "connected" : `down (${cause ?? "dropped"}), polling every ${this.pollMs / 1000} s`
    if (shown !== this.shown) {
      this.shown = shown
      this.log?.(`sync event stream ${shown}`, connected ? "info" : "warn")
    }
    if (connected) this.timers.cancel("poll")
    else if (!this.timers.armed("poll")) this.poll()
  }

  private poll(): void {
    this.timers.arm("poll", this.pollMs, () => {
      this.onPoll()
      this.poll()
    })
  }
}
