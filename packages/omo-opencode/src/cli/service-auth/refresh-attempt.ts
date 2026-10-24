import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"
import type { RecoveryClockReading } from "./recovery-clock"
import { credentialOwnerSchema as ownerSchema, sameStableOwner, type CredentialOwner } from "./credential-owner"
export type { CredentialOwner } from "./credential-owner"

// requestApi allows 30 seconds for transport; reserve another 5 seconds for arrival/clock error.
export const REFRESH_SEND_BUDGET_MS = 60_000 - 30_000 - 5_000
const clockSchema = z.object({
  wallTimeMs: z.number().int().nonnegative().safe(),
  continuousTimeMs: z.number().finite().nonnegative(),
  bootId: z.string().min(1),
})
export const refreshAttemptSchema = z.object({
  writerProtocol: z.literal(2),
  origin: z.string().url(),
  owner: ownerSchema,
  refreshTokenHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  firstSend: clockSchema,
  deadline: z.number().int().nonnegative().safe(),
  state: z.enum(["ready", "sent_unknown", "successor_received_uncommitted", "exhausted"]),
})
export type RefreshAttempt = z.infer<typeof refreshAttemptSchema>

export const refreshTokenHash = (token: string): string => createHash("sha256").update(token).digest("hex")
export const sameOwner = sameStableOwner

export function newRefreshAttempt(
  origin: string, owner: CredentialOwner, token: string, reading: RecoveryClockReading,
  idempotencyKey = randomBytes(32).toString("base64url"),
): RefreshAttempt {
  return {
    writerProtocol: 2, origin, owner: { ...owner }, refreshTokenHash: refreshTokenHash(token),
    idempotencyKey,
    firstSend: { ...reading }, deadline: reading.wallTimeMs + REFRESH_SEND_BUDGET_MS, state: "ready",
  }
}

export function eligibleAttempt(
  raw: unknown,
  origin: string,
  owner: CredentialOwner,
  token: string,
  reading: RecoveryClockReading | null,
): RefreshAttempt | null {
  const parsed = refreshAttemptSchema.safeParse(raw)
  const clock = clockSchema.safeParse(reading)
  if (!parsed.success || !clock.success) return null
  const attempt = parsed.data
  if (attempt.state === "exhausted") return null
  const current = clock.data
  if (attempt.origin !== origin || !sameOwner(attempt.owner, owner) || attempt.owner.generation !== owner.generation ||
      attempt.refreshTokenHash !== refreshTokenHash(token) || attempt.firstSend.bootId !== current.bootId ||
      attempt.deadline !== attempt.firstSend.wallTimeMs + REFRESH_SEND_BUDGET_MS) return null
  const wallElapsed = current.wallTimeMs - attempt.firstSend.wallTimeMs
  const continuousElapsed = current.continuousTimeMs - attempt.firstSend.continuousTimeMs
  if (wallElapsed < 0 || continuousElapsed < 0 || Math.abs(wallElapsed - continuousElapsed) > 1000) return null
  if (Math.max(wallElapsed, continuousElapsed) >= REFRESH_SEND_BUDGET_MS) return null
  return attempt
}
