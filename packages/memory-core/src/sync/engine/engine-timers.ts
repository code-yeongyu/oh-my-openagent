// The engine's named one-shot timers: the stream-down poll, the local-commit debounce and the client-floor recheck
// (#14483). Arming a name replaces its pending timer; stop cancels every one.

import type { Clock } from "./ports"

type TimerName = "poll" | "debounce" | "recheck"

export class EngineTimers {
  private readonly pending = new Map<TimerName, () => void>()

  constructor(private readonly clock: Clock) {}

  arm(name: TimerName, ms: number, fire: () => void): void {
    this.cancel(name)
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
