import type { RoleRuleRecord } from "./roles"
import type { SessionMeta } from "./session"

/**
 * The admission storage port. Admission is pure; this interface is what the session-gateway store
 * implements in the one additive migration (plan todo 11: `users`, `accounts`, `role_rules`,
 * `gateway_session_meta` + `session_collaborators`, `link_codes`). Methods are synchronous
 * because that store is a local SQLite file.
 */

export type UserRecord = { readonly user_id: string; readonly display: string; readonly created_at: string }

export type AccountKey = { readonly platform: string; readonly workspace_id: string; readonly platform_user_id: string }

export type AccountRecord = AccountKey & {
  readonly user_id: string
  readonly linked_via: "code" | "os" | "config"
  readonly created_at: string
}

/** Only the sha256 of a link code is ever stored; the plaintext exists in the mint result alone. */
export type LinkCodeRecord = {
  readonly code_sha256: string
  readonly user_id: string
  readonly expires_at: string
  readonly used_at: string | null
}

export interface LinkCodeStore {
  insertLinkCode(record: LinkCodeRecord): void
  findLinkCode(codeSha256: string): LinkCodeRecord | null
  /** Atomically set `used_at` when it is still null; `false` when the code was already used or is unknown. */
  consumeLinkCode(codeSha256: string, usedAt: string): boolean
}

export interface AccountStore {
  findAccount(key: AccountKey): AccountRecord | null
  insertAccount(record: AccountRecord): void
}

export interface AdmissionStore extends LinkCodeStore, AccountStore {
  findUser(userId: string): UserRecord | null
  insertUser(record: UserRecord): void
  roleRules(gatewayScope: string): readonly RoleRuleRecord[]
  findSessionMeta(sessionDurableId: string): SessionMeta | null
  /** Write the next meta only when the stored one still equals `expected` (null = create); `false` on a lost race. */
  saveSessionMeta(next: SessionMeta, expected: SessionMeta | null): boolean
}
