import type { ProcessIdentity } from "./types"

/** The life of a woken session's row (#13037 A3.1.1); a row past `requested` holds one of the store's places. */
export type WokenSessionState = "requested" | "opening" | "open" | "closing"

export type WokenSessionRow = {
  readonly durable_id: string
  readonly session_file: string
  readonly host_instance: string | null
  readonly state: WokenSessionState
  readonly requested_at: number
  readonly opened_at: number | null
  readonly first_waiting_at: number | null
  /** The carrier: the process identity the store records for a claimant; null while the row is `requested`. */
  readonly lease_owner: ProcessIdentity | null
  readonly lease_expires_at: number | null
  readonly generation: number
  readonly attempts: number
  readonly next_attempt_at: number | null
}

export type WokenSessionKey = { readonly durable_id: string }
export type WokenSessionFence = WokenSessionKey & { readonly generation: number }
export type LostLease = { readonly kind: "lost_lease" }

export type WakeRequestOutcome = { readonly kind: "requested"; readonly row: WokenSessionRow; readonly created: boolean }

export type WakeStartOutcome =
  | { readonly kind: "started"; readonly row: WokenSessionRow }
  | { readonly kind: "overloaded" }
  | { readonly kind: "not_yet"; readonly next_attempt_at: number }
  /** Another carrier already moved the row past `requested`. */
  | { readonly kind: "in_progress"; readonly row: WokenSessionRow }
  | { readonly kind: "not_found" }

export type WakeTakeOverOutcome =
  | { readonly kind: "taken_over"; readonly row: WokenSessionRow; readonly previous_owner_alive: boolean }
  | { readonly kind: "lease_live"; readonly row: WokenSessionRow }
  /** A `requested` row has no lease to take over; `start` takes it. */
  | { readonly kind: "not_leased"; readonly row: WokenSessionRow }
  | { readonly kind: "not_found" }
  | LostLease

export type WakeRetryOutcome =
  | { readonly kind: "deferred"; readonly row: WokenSessionRow }
  | { readonly kind: "failed"; readonly attempts: number }
  | LostLease

export type WokenStateRequest = WokenSessionFence & {
  readonly state: Exclude<WokenSessionState, "requested">
  readonly host_instance?: string
}

/** The store's record of woken sessions (#13037 A3.1); every write is one transaction on the store's own clock. */
export type WokenSessionStore = {
  readonly request: (request: WokenSessionKey & { readonly session_file: string }) => Promise<WakeRequestOutcome>
  readonly start: (request: WokenSessionKey) => Promise<WakeStartOutcome>
  readonly renew: (
    request: WokenSessionFence,
  ) => Promise<{ readonly kind: "renewed"; readonly row: WokenSessionRow } | LostLease>
  readonly takeOver: (request: WokenSessionKey) => Promise<WakeTakeOverOutcome>
  readonly setState: (
    request: WokenStateRequest,
  ) => Promise<{ readonly kind: "ok"; readonly row: WokenSessionRow } | LostLease>
  readonly recordWaiting: (
    request: WokenSessionFence,
  ) => Promise<{ readonly kind: "ok"; readonly row: WokenSessionRow } | LostLease>
  readonly retryLater: (request: WokenSessionFence) => Promise<WakeRetryOutcome>
  readonly end: (request: WokenSessionFence) => Promise<{ readonly kind: "ended" } | LostLease>
  /** True only for an `opening` row whose lease is live: the later drain admits nothing for such a session (A3.1.5). */
  readonly gated: (request: WokenSessionKey) => Promise<boolean>
  readonly list: () => Promise<readonly WokenSessionRow[]>
}
