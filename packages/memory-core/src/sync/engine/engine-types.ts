// The engine's public shapes: what its status shows, a failure as shown, and what one cycle reports.

import type { SyncFailure } from "./failure"
import type { FreezeReason, RefusalCode } from "./ports"

export type EngineStatus =
  | { readonly kind: "never_synced" }
  /**
   * `updatedWhileOffline`: the memories the catch-up after this device's latest offline gap updated (`gap` in
   * SyncEngine says what a gap is). Absent when the latest entries it received came in with no gap before them.
   */
  | { readonly kind: "synced"; readonly at: number; readonly updatedWhileOffline?: number }
  | { readonly kind: "paused"; readonly seq: number; readonly code: RefusalCode; readonly held?: Failing }
  /** Pushes are frozen by the service until a key rotation lands (sync-design section 7). */
  | { readonly kind: "frozen"; readonly reason: FreezeReason; readonly since: number }
  | { readonly kind: "failing"; readonly failure: SyncFailure; readonly since: number; readonly attempts: number }

export interface Failing {
  readonly failure: SyncFailure
  readonly since: number
  readonly attempts: number
}

export interface CycleReport {
  readonly applied: number
  readonly refused: number
  /** Received items this cycle dropped because their key may never reach this device's files. */
  readonly rejectedItems: number
  readonly pushed: boolean
  readonly snapshot: number | null
  /** Keys held out of the push because one change to each exceeds the batch bound (#12284). */
  readonly held: readonly string[]
}
