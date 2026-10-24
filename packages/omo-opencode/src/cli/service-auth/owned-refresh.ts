import { CredentialStoreError } from "./keystore"
import { ApiRefusal, SignInError } from "./protocol"
import { eligibleAttempt, newRefreshAttempt, sameOwner, type RefreshAttempt } from "./refresh-attempt"
import { readRecoveryClock, type RecoveryClock } from "./recovery-clock"
import type { OwnedCredential } from "./protocol-v2"
export type { OwnedCredential } from "./protocol-v2"

export class RecoveryExhausted extends SignInError {
  readonly code = "refresh_recovery_expired"
  readonly deviceRevoked = false
  constructor() { super("Refresh recovery can no longer be proved safe. Sign in again with omo login.") }
}

export class RecoveryPending extends SignInError {
  constructor(readonly deadline: number) {
    super("The refresh outcome is unknown. Retry only before the recorded recovery deadline.", true)
  }
}

export class OwnedSessionEnded extends SignInError {
  constructor(readonly code: string, readonly deviceRevoked: boolean) {
    super("Sign in again with omo login.")
  }
}

const terminal = new Set([
  "unauthorized", "invalid_grant", "account_deleted", "reauth_required", "device_revoked",
  "client_upgrade_required", "writer_floor_mismatch", "refresh_recovery_expired",
])
const revoked = new Set(["account_deleted", "reauth_required", "device_revoked"])

// Both the active credential and a revocation-owned credential use this transaction. The caller
// holds the per-origin lock and supplies the only store this rotation is allowed to update.
export async function refreshOwnedCredential(options: {
  readonly origin: string
  readonly current: OwnedCredential
  readonly clock?: RecoveryClock
  readonly write: (credential: OwnedCredential) => Promise<void>
  readonly rotate: (credential: OwnedCredential, attempt: RefreshAttempt) => Promise<OwnedCredential>
}): Promise<OwnedCredential> {
  const { current, origin, write, rotate } = options
  const clock = options.clock ?? readRecoveryClock
  const first = await clock()
  if (first === null) throw new RecoveryExhausted()
  if (current.refreshState === "uncertain" && current.refreshAttempt === undefined) throw new RecoveryExhausted()
  if (current.refreshAttempt === undefined && Date.parse(current.accessTokenExpiresAt) > first.wallTimeMs + 30_000) return current
  const attempt = current.refreshAttempt === undefined
    ? newRefreshAttempt(origin, current.owner, current.refreshToken, first)
    : eligibleAttempt(current.refreshAttempt, origin, current.owner, current.refreshToken, first)
  if (attempt === null) throw new RecoveryExhausted()
  if (current.refreshAttempt === undefined) await write({ ...current, refreshState: "uncertain", refreshAttempt: attempt })
  const sent: RefreshAttempt = { ...attempt, state: "sent_unknown" }
  await write({ ...current, refreshState: "uncertain", refreshAttempt: sent })
  if (eligibleAttempt(sent, origin, current.owner, current.refreshToken, await clock()) === null) throw new RecoveryExhausted()
  let successor: OwnedCredential
  try {
    successor = await rotate(current, sent)
  } catch (error) {
    if (error instanceof CredentialStoreError) throw error
    if (error instanceof ApiRefusal && error.status < 500 && error.status !== 429 && terminal.has(error.code)) {
      await write({ ...current, refreshState: "uncertain", refreshAttempt: { ...attempt, state: "exhausted" } })
      throw new OwnedSessionEnded(error.code, revoked.has(error.code))
    }
    // A refused or unsent transmission says nothing about any earlier unanswered transmission.
    // Keep the identity and deadline even for invalid_request, 429, or a connection refusal.
    if (eligibleAttempt(sent, origin, current.owner, current.refreshToken, await clock()) === null) throw new RecoveryExhausted()
    throw new RecoveryPending(attempt.deadline)
  }
  if (successor.writerFloor !== 2 || !sameOwner(current.owner, successor.owner) ||
      successor.owner.generation !== current.owner.generation + 1 ||
      successor.refreshToken === current.refreshToken || successor.device.id !== current.owner.deviceId) {
    if (eligibleAttempt(sent, origin, current.owner, current.refreshToken, await clock()) === null) throw new RecoveryExhausted()
    throw new RecoveryPending(attempt.deadline)
  }
  await write({ ...current, refreshState: "uncertain", refreshAttempt: { ...attempt, state: "successor_received_uncommitted" } })
  const { refreshAttempt: _attempt, refreshState: _state, ...committed } = successor
  // A failed replacement retains successor_received_uncommitted with the original attempt identity.
  // No successor token is published.
  await write(committed)
  return committed
}
