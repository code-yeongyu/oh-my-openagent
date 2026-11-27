// The engine's named one-shot timers: the stream-down poll, the local-commit debounce and the client-floor recheck
// (#14483). Arming a name replaces its pending timer; cancelAll cancels every one, and nothing arms while the engine is
// stopped, so a cycle that settles after stop() leaves nothing armed (#14483 review L1).

import type { Clock } from "./ports"

type TimerName = "poll" | "debounce" | "recheck"

export class EngineTimers {
  private readonly pending = new Map<TimerName, () => void>()

  constructor(
    private readonly clock: Clock,
    private readonly stopped: () => boolean,
  ) {}

  arm(name: TimerName, ms: number, fire: () => void): void {
    this.cancel(name)
    if (this.stopped()) return
    this.pending.set(
      name,
      this.clock.after(ms, () => {
        this.pending.delete(name)
        fire()
      }),
    )
  }

  armed(name: TimerName): boolean {
    return this.pending.has(name)
  }

  cancel(name: TimerName): void {
    this.pending.get(name)?.()
    this.pending.delete(name)
  }

  cancelAll(): void {
    for (const cancel of this.pending.values()) cancel()
    this.pending.clear()
  }
}
