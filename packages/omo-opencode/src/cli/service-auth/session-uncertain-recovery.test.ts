import { expect, test } from "bun:test"
import { CredentialStoreError } from "./keystore"
import { type OwnedCredential, refreshOwnedCredential } from "./owned-refresh"
import { ApiRefusal, RequestFailure } from "./protocol"
import { eligibleAttempt, newRefreshAttempt, REFRESH_SEND_BUDGET_MS, type RefreshAttempt } from "./refresh-attempt"
import { readRecoveryClock } from "./recovery-clock"
import { grant, privateKeys } from "./test-support"

const origin = "https://synthetic.example"
const initial: OwnedCredential = {
  ...grant, ...privateKeys, accessTokenExpiresAt: "2000-01-01T00:00:00Z", writerFloor: 2,
  owner: { accountId: "account-A", deviceId: grant.device.id, familyId: "family-A", generation: 7, ownerHandle: "handle-A" },
}

function world() {
  let wallTimeMs = 1_900_000_000_000
  let continuousTimeMs = 100_000
  let bootId = "boot-A"
  let stored = structuredClone(initial)
  const rows = new Map<string, { credential: OwnedCredential; usedAt?: number; key?: string; successor?: string }>()
  rows.set(initial.refreshToken, { credential: initial })
  const sends: { token: string; key: string | null }[] = []
  let remotelyRevoked = false
  const reading = () => ({ wallTimeMs, continuousTimeMs, bootId })
  const send = async (current: OwnedCredential, key: string | null): Promise<OwnedCredential> => {
    sends.push({ token: current.refreshToken, key })
    if (key !== null && !/^[A-Za-z0-9_-]{43,128}$/.test(key)) throw new ApiRefusal("invalid_request", 400)
    const row = rows.get(current.refreshToken)
    if (row === undefined || remotelyRevoked) throw new ApiRefusal("device_revoked", 401)
    if (row.usedAt !== undefined) {
      const successor = row.successor === undefined ? undefined : rows.get(row.successor)
      if (key !== null && row.key === key && wallTimeMs - row.usedAt <= 60_000 && successor?.usedAt === undefined && successor !== undefined) {
        return structuredClone(successor.credential)
      }
      remotelyRevoked = true
      throw new ApiRefusal("reauth_required", 401)
    }
    const successor: OwnedCredential = {
      ...initial, owner: { ...row.credential.owner, generation: row.credential.owner.generation + 1 },
      accessToken: `access-${rows.size}`, refreshToken: `refresh-${rows.size}`, accessTokenExpiresAt: new Date(wallTimeMs + 3600_000).toISOString(),
    }
    row.usedAt = wallTimeMs
    if (key !== null) row.key = key
    row.successor = successor.refreshToken
    rows.set(successor.refreshToken, { credential: successor })
    return structuredClone(successor)
  }
  const write = async (next: OwnedCredential) => { stored = structuredClone(next) }
  const rotate = (current: OwnedCredential, attempt: RefreshAttempt) => send(current, attempt.idempotencyKey)
  return {
    reading, send, write, rotate, sends,
    current: () => stored,
    set: (credential: OwnedCredential) => { stored = credential },
    advance: (ms: number) => { wallTimeMs += ms; continuousTimeMs += ms },
    wall: (ms: number) => { wallTimeMs += ms },
    continuous: (ms: number) => { continuousTimeMs += ms },
    reboot: () => { bootId = "boot-B"; continuousTimeMs = 1 },
    refresh: (overrides: Partial<Parameters<typeof refreshOwnedCredential>[0]> = {}) =>
      refreshOwnedCredential({ origin, current: stored, clock: async () => reading(), write, rotate, ...overrides }),
  }
}

test("the native recovery clock supplies a boot identity and suspend-inclusive uptime", async () => {
  const first = await readRecoveryClock()
  const next = await readRecoveryClock()
  expect(first).not.toBeNull()
  expect(next).not.toBeNull()
  if (first === null || next === null) throw new Error("native recovery clock unavailable")
  expect(next.bootId).toBe(first.bootId)
  expect(next.continuousTimeMs).toBeGreaterThanOrEqual(first.continuousTimeMs)
})

test("lost-answer recovery across restart preserves the complete immutable attempt", async () => {
  const w = world()
  await expect(w.refresh({ rotate: async (current, attempt) => {
    await w.rotate(current, attempt)
    throw new RequestFailure(false)
  } })).rejects.toMatchObject({ retryable: true, deadline: w.reading().wallTimeMs + REFRESH_SEND_BUDGET_MS })
  const original = structuredClone(w.current().refreshAttempt)
  w.advance(5000)

  const successor = await w.refresh()

  expect(w.sends).toHaveLength(2)
  expect(w.sends[1]).toEqual(w.sends[0])
  expect(successor.owner.generation).toBe(8)
  expect(successor.refreshAttempt).toBeUndefined()
  expect(eligibleAttempt(original, origin, initial.owner, initial.refreshToken, w.reading())).toMatchObject(original)
})

test.each(["missing", "malformed", "origin", "token", "generation", "owner", "key", "deadline", "boot", "expired", "exhausted", "rollback", "sleep", "clock-loss"] as const)(
  "%s proof never sends or generates another attempt", async change => {
    const w = world()
    const attempt = newRefreshAttempt(origin, initial.owner, initial.refreshToken, w.reading())
    let raw: unknown = attempt
    switch (change) {
      case "missing": raw = undefined; break
      case "malformed": raw = { idempotencyKey: attempt.idempotencyKey }; break
      case "origin": raw = { ...attempt, origin: "https://other.example" }; break
      case "token": raw = { ...attempt, refreshTokenHash: "0".repeat(64) }; break
      case "generation": raw = { ...attempt, owner: { ...attempt.owner, generation: 8 } }; break
      case "owner": raw = { ...attempt, owner: { ...attempt.owner, ownerHandle: "handle-B" } }; break
      case "key": raw = { ...attempt, idempotencyKey: "draft-key" }; break
      case "deadline": raw = { ...attempt, deadline: attempt.deadline + 1 }; break
      case "boot": w.reboot(); break
      case "expired": w.advance(REFRESH_SEND_BUDGET_MS); break
      case "exhausted": raw = { ...attempt, state: "exhausted" }; break
      case "rollback": w.wall(-1); break
      case "sleep": w.advance(120_000); break
      case "clock-loss": break
    }
    w.set({ ...initial, refreshState: "uncertain", refreshAttempt: raw })
    await expect(w.refresh(change === "clock-loss" ? { clock: async () => null } : {}))
      .rejects.toMatchObject({ code: "refresh_recovery_expired", deviceRevoked: false })
    expect(w.sends).toHaveLength(0)
    expect(w.current().refreshAttempt).toEqual(raw)
  },
)

test("a wall correction cannot hide a sleep past the deadline", async () => {
  const w = world()
  w.set({ ...initial, refreshAttempt: newRefreshAttempt(origin, initial.owner, initial.refreshToken, w.reading()) })
  w.continuous(120_000)
  w.wall(10_000)
  await expect(w.refresh()).rejects.toMatchObject({ code: "refresh_recovery_expired" })
  expect(w.sends).toHaveLength(0)
})

test("journal storage delay is rechecked immediately before transmission", async () => {
  const w = world()
  await expect(w.refresh({ write: async next => { await w.write(next); w.advance(REFRESH_SEND_BUDGET_MS) } }))
    .rejects.toMatchObject({ code: "refresh_recovery_expired" })
  expect(w.sends).toHaveLength(0)
})

test("failed journal storage sends nothing", async () => {
  const w = world()
  await expect(w.refresh({ write: async () => { throw new CredentialStoreError("synthetic storage refusal") } })).rejects.toBeInstanceOf(CredentialStoreError)
  expect(w.sends).toHaveLength(0)
  expect(w.current()).toEqual(initial)
})

test("failed successor storage publishes nothing and keeps the original recovery key", async () => {
  const w = world()
  await expect(w.refresh({ write: async next => {
    if (next.refreshToken !== initial.refreshToken) throw new CredentialStoreError("synthetic commit refusal")
    await w.write(next)
  } })).rejects.toBeInstanceOf(CredentialStoreError)
  expect(w.current().refreshToken).toBe(initial.refreshToken)
  expect(await w.refresh()).toMatchObject({ owner: { generation: 8 } })
  expect(w.sends[1]).toEqual(w.sends[0])
})

test.each(["invalid_request", "rate_limited", "unavailable"] as const)("%s retains the original key and deadline", async code => {
  const w = world()
  await expect(w.refresh({ rotate: async (current, attempt) => {
    await w.rotate(current, attempt)
    throw new RequestFailure(false)
  } })).rejects.toThrow()
  const original = structuredClone(w.current().refreshAttempt)
  w.advance(1000)
  await expect(w.refresh({ rotate: async () => { throw new ApiRefusal(code, code === "rate_limited" ? 429 : code === "unavailable" ? 503 : 400, undefined, "60") } }))
    .rejects.toMatchObject({ retryable: true })
  expect(w.current().refreshAttempt).toEqual(original)
  w.advance(REFRESH_SEND_BUDGET_MS)
  await expect(w.refresh()).rejects.toMatchObject({ code: "refresh_recovery_expired" })
  expect(w.sends).toHaveLength(1)
})

test("a locally eligible retry arriving late accepts the service's terminal result", async () => {
  const w = world()
  await expect(w.refresh({ rotate: async (current, attempt) => {
    await w.rotate(current, attempt)
    throw new RequestFailure(false)
  } })).rejects.toThrow()
  await expect(w.refresh({ rotate: async (current, attempt) => { w.advance(60_001); return w.rotate(current, attempt) } }))
    .rejects.toMatchObject({ code: "reauth_required", deviceRevoked: true })
})

test("the faithful fake accepts keyless initial rotation but never keyless recovery", async () => {
  const w = world()
  expect((await w.send(initial, null)).owner.generation).toBe(8)
  await expect(w.send(initial, null)).rejects.toMatchObject({ code: "reauth_required" })
})

test.each(["another-key", "used-successor", "expired"] as const)("the faithful fake refuses %s replay", async mode => {
  const w = world()
  const key = "j".repeat(43)
  const next = await w.send(initial, key)
  if (mode === "used-successor") await w.send(next, "k".repeat(43))
  if (mode === "expired") w.advance(60_001)
  await expect(w.send(initial, mode === "another-key" ? "k".repeat(43) : key)).rejects.toMatchObject({ code: "reauth_required" })
})

test("the faithful fake keeps the original server used_at at the inclusive boundary", async () => {
  const w = world()
  const key = "j".repeat(43)
  const next = await w.send(initial, key)
  w.advance(60_000)
  expect(await w.send(initial, key)).toEqual(next)
  w.advance(1)
  await expect(w.send(initial, key)).rejects.toMatchObject({ code: "reauth_required" })
})
