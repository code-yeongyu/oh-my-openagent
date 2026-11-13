// What an engine's status shows ahead of its journal (#10637, #12280): a failure once it crosses its
// visibility threshold, cleared only by a successful cycle, else a service freeze. Each change is a
// key the engine compares to announce transitions only.

import { describeSyncFailure, isFailureShown, type SyncFailure } from "./failure"
import type { Frozen } from "./push-cycle"

interface Failing {
  readonly failure: SyncFailure
  readonly since: number
  readonly attempts: number
}

export type TrackedStatus =
  | { readonly kind: "failing"; readonly failure: SyncFailure; readonly since: number; readonly attempts: number }
  | ({ readonly kind: "frozen" } & Frozen)

export class StatusTracker {
  private failing: Failing | null = null
  /** The failure a UI shows: set once a failure crosses its visibility threshold, cleared only by a successful cycle. */
  private shown: Failing | null = null
  frozen: Frozen | null = null

  constructor(private readonly now: () => number) {}

  /** Failing outranks frozen: while no cycle completes nothing moves at all. Null: the journal decides. */
  tracked(): TrackedStatus | null {
    if (this.shown !== null) return { kind: "failing", ...this.shown }
    return this.frozen === null ? null : { kind: "frozen", ...this.frozen }
  }

  /** The shown failure's kind and action (a new stranded lock path is a change too), else the freeze. */
  key(): string | null {
    if (this.shown !== null) return `${this.shown.failure.kind}\n${this.shown.failure.action}`
    return this.frozen === null ? null : `frozen\n${this.frozen.reason}`
  }

  succeeded(): void {
    this.failing = null
    this.shown = null
  }

  failed(error: unknown): void {
    const failure = describeSyncFailure(error)
    const previous = this.failing
    const failing =
      previous?.failure.kind === failure.kind
        ? { failure, since: previous.since, attempts: previous.attempts + 1 }
        : { failure, since: this.now(), attempts: 1 }
    this.failing = failing
    // A failure below its threshold (an offline blip) never replaces or clears what is shown: only a
    // successful cycle clears a shown failure.
    if (!isFailureShown(failing.failure.kind, failing.attempts)) return
    const shown = this.shown
    this.shown =
      shown !== null && shown.failure.kind === failure.kind && shown.failure.action === failure.action
        ? { failure, since: shown.since, attempts: shown.attempts + 1 }
        : failing
  }
}
