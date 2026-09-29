import { createHash } from "node:crypto"

import { type Actor, decide, type DecisionReason, validHuman, type Via } from "./decide"
import type { AccountKey, AccountRecord, AccountStore, LinkCodeStore } from "./store"

/**
 * One-time account link codes. A code is 8 characters of Crockford base32 from a CSPRNG (40 bits),
 * lives 10 minutes, is single use, and only its sha256 is stored. It is redeemed with `link <code>`
 * in a 1:1 DM from the platform account being linked, which yields that account's `accounts` row.
 * Minting a code for yourself needs a linked human in the TUI or a DM; minting one for someone
 * else is the `grant_role` row (scope owner, TUI or DM only).
 */

export const LINK_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
export const LINK_CODE_LENGTH = 8
export const LINK_CODE_TTL_MS = 10 * 60 * 1000

const LINK_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{8}$/

export type MintRefusal = DecisionReason | "self_link_outside_tui_or_dm"
export type MintResult =
  | { readonly ok: true; readonly code: string; readonly expires_at: string }
  | { readonly ok: false; readonly reason: MintRefusal }

export type RedeemRefusal =
  | "not_dm"
  | "malformed_account"
  | "malformed_code"
  | "code_unknown"
  | "code_expired"
  | "code_used"
  | "account_linked_to_other_user"
export type RedeemResult =
  | { readonly ok: true; readonly account: AccountRecord; readonly already_linked: boolean }
  | { readonly ok: false; readonly reason: RedeemRefusal }

export function hashLinkCode(code: string): string {
  return createHash("sha256").update(code).digest("hex")
}

/** 32 symbols divide 256 evenly, so masking a random byte to 5 bits is unbiased. */
export function generateLinkCode(randomBytes: (length: number) => Uint8Array = (length) => crypto.getRandomValues(new Uint8Array(length))): string {
  const bytes = randomBytes(LINK_CODE_LENGTH)
  let code = ""
  for (const byte of bytes) code += LINK_CODE_ALPHABET.charAt(byte & 31)
  return code
}

/** Uppercase and drop spaces/hyphens a user may type; `null` unless exactly 8 alphabet symbols remain. */
export function normalizeLinkCode(input: string): string | null {
  const code = input.replace(/[\s-]/g, "").toUpperCase()
  return LINK_CODE_PATTERN.test(code) ? code : null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/** Validates the actor the same way `decide` does before the self branch, so an unknown role or malformed actor can never self-mint. */
function mintAllowed(actor: Actor | null | undefined, forUserId: string, via: Via): { ok: true } | { ok: false; reason: MintRefusal } {
  if (actor?.principal === "agent") return { ok: false, reason: "agent_principal" }
  if (!validHuman(actor)) return { ok: false, reason: "missing_actor" }
  if (actor.user_id === forUserId) {
    if (actor.role === "guest") return { ok: false, reason: "role_denied" }
    return via === "tui" || via === "dm" ? { ok: true } : { ok: false, reason: "self_link_outside_tui_or_dm" }
  }
  const decision = decide(actor, "grant_role", null, { via, grant: { kind: "link_code", for_user_id: forUserId } })
  return decision.allow ? { ok: true } : { ok: false, reason: decision.reason }
}

export function mintLinkCode(
  store: LinkCodeStore,
  input: { readonly actor: Actor | null | undefined; readonly for_user_id: string; readonly via: Via; readonly now: Date },
  randomBytes?: (length: number) => Uint8Array,
): MintResult {
  if (input.for_user_id.length === 0) return { ok: false, reason: "missing_grant" }
  const allowed = mintAllowed(input.actor, input.for_user_id, input.via)
  if (!allowed.ok) return allowed
  const code = generateLinkCode(randomBytes)
  const expiresAt = new Date(input.now.getTime() + LINK_CODE_TTL_MS).toISOString()
  store.insertLinkCode({ code_sha256: hashLinkCode(code), user_id: input.for_user_id, expires_at: expiresAt, used_at: null })
  return { ok: true, code, expires_at: expiresAt }
}

/**
 * Redeem `link <code>`. Checks run cheapest-and-non-destructive first: a non-DM, malformed account key, malformed, unknown,
 * expired or conflicting redeem never burns the code; only the atomic consume marks it used, so a
 * replay or a concurrent second redeem is refused.
 */
export function redeemLinkCode(
  store: LinkCodeStore & AccountStore,
  input: { readonly code: string; readonly from: AccountKey & { readonly dm: boolean }; readonly now: Date },
): RedeemResult {
  if (input.from.dm !== true) return { ok: false, reason: "not_dm" }
  const { platform, workspace_id, platform_user_id } = input.from
  if (!isNonEmptyString(platform) || !isNonEmptyString(workspace_id) || !isNonEmptyString(platform_user_id)) {
    return { ok: false, reason: "malformed_account" }
  }
  const code = normalizeLinkCode(input.code)
  if (code === null) return { ok: false, reason: "malformed_code" }
  const sha = hashLinkCode(code)
  const record = store.findLinkCode(sha)
  if (record === null) return { ok: false, reason: "code_unknown" }
  if (record.used_at !== null) return { ok: false, reason: "code_used" }
  if (input.now.getTime() >= Date.parse(record.expires_at)) return { ok: false, reason: "code_expired" }
  const key: AccountKey = { platform, workspace_id, platform_user_id }
  const existing = store.findAccount(key)
  if (existing !== null && existing.user_id !== record.user_id) return { ok: false, reason: "account_linked_to_other_user" }
  const usedAt = input.now.toISOString()
  if (!store.consumeLinkCode(sha, usedAt)) return { ok: false, reason: "code_used" }
  if (existing !== null) return { ok: true, account: existing, already_linked: true }
  const account: AccountRecord = { ...key, user_id: record.user_id, linked_via: "code", created_at: usedAt }
  store.insertAccount(account)
  return { ok: true, account, already_linked: false }
}
