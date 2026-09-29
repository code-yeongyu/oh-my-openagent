import { describe, expect, test } from "bun:test"

import type { Actor } from "./decide"
import { generateLinkCode, hashLinkCode, LINK_CODE_TTL_MS, mintLinkCode, normalizeLinkCode, redeemLinkCode } from "./link"
import type { AccountKey, AccountRecord, AccountStore, LinkCodeRecord, LinkCodeStore } from "./store"

function memoryStore(): LinkCodeStore & AccountStore & { codes: Map<string, LinkCodeRecord>; accounts: AccountRecord[] } {
  const codes = new Map<string, LinkCodeRecord>()
  const accounts: AccountRecord[] = []
  const sameKey = (a: AccountKey, b: AccountKey) =>
    a.platform === b.platform && a.workspace_id === b.workspace_id && a.platform_user_id === b.platform_user_id
  return {
    codes,
    accounts,
    insertLinkCode: (record) => void codes.set(record.code_sha256, record),
    findLinkCode: (sha) => codes.get(sha) ?? null,
    consumeLinkCode: (sha, usedAt) => {
      const record = codes.get(sha)
      if (record === undefined || record.used_at !== null) return false
      codes.set(sha, { ...record, used_at: usedAt })
      return true
    },
    findAccount: (key) => accounts.find((account) => sameKey(account, key)) ?? null,
    insertAccount: (record) => void accounts.push(record),
  }
}

const ALICE = "u_000ALICE"
const NOW = new Date("2026-09-29T00:00:00.000Z")
const OWNER: Actor = { principal: "human", user_id: ALICE, role: "owner" }
const DM = { platform: "slack", workspace_id: "T000TEST", platform_user_id: "U000ALICE", dm: true }
const later = (ms: number) => new Date(NOW.getTime() + ms)

function mint(store: ReturnType<typeof memoryStore>): string {
  const minted = mintLinkCode(store, { actor: OWNER, for_user_id: ALICE, via: "tui", now: NOW })
  if (!minted.ok) throw new Error(minted.reason)
  return minted.code
}

describe("link codes", () => {
  test("a code is 8 alphabet chars from the CSPRNG and only its sha256 is stored", () => {
    const store = memoryStore()
    const code = mint(store)
    expect(normalizeLinkCode(code)).toBe(code)
    expect([...store.codes.keys()]).toEqual([hashLinkCode(code)])
    expect(JSON.stringify([...store.codes.values()])).not.toContain(code)
    expect(store.codes.get(hashLinkCode(code))?.expires_at).toBe(later(LINK_CODE_TTL_MS).toISOString())
    const seen = new Set(Array.from({ length: 200 }, () => generateLinkCode()))
    expect(seen.size).toBe(200)
  })

  test("redeeming from a DM links that account to the code's user", () => {
    const store = memoryStore()
    const result = redeemLinkCode(store, { code: mint(store).toLowerCase(), from: DM, now: later(60_000) })
    expect(result).toEqual({
      ok: true,
      already_linked: false,
      account: { platform: "slack", workspace_id: "T000TEST", platform_user_id: "U000ALICE", user_id: ALICE, linked_via: "code", created_at: later(60_000).toISOString() },
    })
  })

  test("an expired code is refused and not burned", () => {
    const store = memoryStore()
    const code = mint(store)
    expect(redeemLinkCode(store, { code, from: DM, now: later(LINK_CODE_TTL_MS) })).toEqual({ ok: false, reason: "code_expired" })
    expect(store.codes.get(hashLinkCode(code))?.used_at).toBeNull()
    expect(store.accounts).toEqual([])
  })

  test("a reused code is refused", () => {
    const store = memoryStore()
    const code = mint(store)
    expect(redeemLinkCode(store, { code, from: DM, now: later(1_000) }).ok).toBe(true)
    const other = { ...DM, platform_user_id: "U000MALLORY" }
    expect(redeemLinkCode(store, { code, from: other, now: later(2_000) })).toEqual({ ok: false, reason: "code_used" })
    expect(store.accounts).toHaveLength(1)
  })

  test("a lost consume race is refused as used", () => {
    const store = memoryStore()
    const code = mint(store)
    const racing = { ...store, consumeLinkCode: () => false }
    expect(redeemLinkCode(racing, { code, from: DM, now: later(1_000) })).toEqual({ ok: false, reason: "code_used" })
  })

  test("a redeem outside a DM, or of a malformed or unknown code, is refused without burning the code", () => {
    const store = memoryStore()
    const code = mint(store)
    expect(redeemLinkCode(store, { code, from: { ...DM, dm: false }, now: later(1_000) })).toEqual({ ok: false, reason: "not_dm" })
    expect(redeemLinkCode(store, { code: "ABC", from: DM, now: later(1_000) })).toEqual({ ok: false, reason: "malformed_code" })
    expect(redeemLinkCode(store, { code: "IIIIIIII", from: DM, now: later(1_000) })).toEqual({ ok: false, reason: "malformed_code" })
    expect(redeemLinkCode(store, { code: "00000000", from: DM, now: later(1_000) })).toEqual({ ok: false, reason: "code_unknown" })
    expect(store.codes.get(hashLinkCode(code))?.used_at).toBeNull()
  })

  test("a redeem from a DM with a malformed account key is refused without burning the code or linking", () => {
    const store = memoryStore()
    const code = mint(store)
    for (const from of [
      JSON.parse('{"platform":"","workspace_id":"","platform_user_id":"","dm":true}'),
      JSON.parse('{"platform":"slack","workspace_id":"T000TEST","platform_user_id":"","dm":true}'),
      JSON.parse('{"platform":"slack","workspace_id":"T000TEST","dm":true}'),
      JSON.parse('{"platform":"slack","workspace_id":7,"platform_user_id":"U000ALICE","dm":true}'),
    ]) {
      expect(redeemLinkCode(store, { code, from, now: later(1_000) })).toEqual({ ok: false, reason: "malformed_account" })
    }
    expect(store.codes.get(hashLinkCode(code))?.used_at).toBeNull()
    expect(store.accounts).toEqual([])
    expect(redeemLinkCode(store, { code, from: DM, now: later(2_000) }).ok).toBe(true)
  })

  test("an account already linked to another user is not relinked", () => {
    const store = memoryStore()
    store.insertAccount({ platform: "slack", workspace_id: "T000TEST", platform_user_id: "U000ALICE", user_id: "u_000OTHER", linked_via: "config", created_at: NOW.toISOString() })
    const code = mint(store)
    expect(redeemLinkCode(store, { code, from: DM, now: later(1_000) })).toEqual({ ok: false, reason: "account_linked_to_other_user" })
    expect(store.codes.get(hashLinkCode(code))?.used_at).toBeNull()
  })
})

describe("minting authority", () => {
  test("codes for others need the scope owner in the TUI or a DM", () => {
    const store = memoryStore()
    const forBob = (actor: Actor | null, via: "tui" | "dm" | "group") => mintLinkCode(store, { actor, for_user_id: "u_000BOB", via, now: NOW })
    expect(forBob(OWNER, "dm").ok).toBe(true)
    expect(forBob(OWNER, "group")).toEqual({ ok: false, reason: "grant_outside_tui_or_dm" })
    expect(forBob({ principal: "human", user_id: ALICE, role: "trusted" }, "dm")).toEqual({ ok: false, reason: "role_denied" })
    expect(forBob({ principal: "agent", session_durable_id: "s_000LEAD" }, "dm")).toEqual({ ok: false, reason: "agent_principal" })
    expect(forBob(null, "tui")).toEqual({ ok: false, reason: "missing_actor" })
    expect(store.codes.size).toBe(1)
  })

  test("a linked human may mint a code for themselves in the TUI or a DM, never in a group or as a guest", () => {
    const store = memoryStore()
    const self = (role: "guest" | "member", via: "tui" | "dm" | "group") =>
      mintLinkCode(store, { actor: { principal: "human", user_id: "u_000BOB", role }, for_user_id: "u_000BOB", via, now: NOW })
    expect(self("member", "dm").ok).toBe(true)
    expect(self("member", "group")).toEqual({ ok: false, reason: "self_link_outside_tui_or_dm" })
    expect(self("guest", "dm")).toEqual({ ok: false, reason: "role_denied" })
  })

  test("an unknown role or a malformed actor whose user_id equals for_user_id cannot self-mint", () => {
    const store = memoryStore()
    const selfMint = (actor: Actor | null) => mintLinkCode(store, { actor, for_user_id: "u_000BOB", via: "dm", now: NOW })
    expect(selfMint(JSON.parse('{"principal":"human","user_id":"u_000BOB","role":"superadmin"}'))).toEqual({ ok: false, reason: "missing_actor" })
    expect(selfMint(JSON.parse('{"principal":"human","user_id":"u_000BOB","role":"__proto__"}'))).toEqual({ ok: false, reason: "missing_actor" })
    expect(selfMint(JSON.parse('{"principal":"human","user_id":"u_000BOB","role":"Member"}'))).toEqual({ ok: false, reason: "missing_actor" })
    expect(selfMint(JSON.parse('{"principal":"human","user_id":"u_000BOB"}'))).toEqual({ ok: false, reason: "missing_actor" })
    expect(selfMint(JSON.parse('{"principal":"human","user_id":"u_000BOB","role":null}'))).toEqual({ ok: false, reason: "missing_actor" })
    expect(selfMint(JSON.parse('{"user_id":"u_000BOB","role":"owner"}'))).toEqual({ ok: false, reason: "missing_actor" })
    expect(store.codes.size).toBe(0)
    for (const role of ["member", "trusted", "owner"] as const) {
      expect(selfMint({ principal: "human", user_id: "u_000BOB", role }).ok).toBe(true)
    }
    expect(store.codes.size).toBe(3)
  })
})
