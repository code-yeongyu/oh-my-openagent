import { expect, test } from "bun:test"
import type { SealedStore } from "./keystore"
import { ownerHasPendingRevocation, revokePending } from "./pending-revocation"
import type { OwnedCredential, Revocations, RevokePendingRequest } from "./protocol-v2"
import { grant, privateKeys } from "./test-support"

const credential = (id: string, generation = 7): OwnedCredential => ({
  ...grant, ...privateKeys, device: { id: `device-${id}`, name: id }, refreshToken: `refresh-${id}-${generation}`,
  writerFloor: 2, owner: { accountId: `account-${id}`, deviceId: `device-${id}`, familyId: `family-${id}`, generation, ownerHandle: `handle-${id}` },
})
const A = credential("A")
const B = credential("B")
const request: RevokePendingRequest = { version: 2, revocationId: "revoke-A", owner: A.owner }

function store<T>(initial: T | null) {
  let value = structuredClone(initial)
  const writes: (T | null)[] = []
  const port: SealedStore<T> = {
    read: async () => structuredClone(value),
    write: async next => { value = structuredClone(next); writes.push(value) },
    clear: async () => { value = null; writes.push(null) },
  }
  return { port, writes, get: () => structuredClone(value) }
}

function world() {
  const active = store<OwnedCredential>(A)
  const pending = store<Revocations>(null)
  const revoked: string[] = []
  let outcome: "confirmed" | "unconfirmed" = "unconfirmed"
  const deps = {
    active: active.port, pending: pending.port,
    refresh: async (current: OwnedCredential, write: (next: OwnedCredential) => Promise<void>) => {
      const next = { ...current, owner: { ...current.owner, generation: current.owner.generation + 1 }, refreshToken: `${current.refreshToken}-next` }
      await write({ ...current, refreshAttempt: { synthetic: "original-attempt" } })
      await write(next)
      return { state: "ready" as const, credential: next }
    },
    revoke: async (current: OwnedCredential) => { revoked.push(current.owner.deviceId); return outcome },
  }
  return { active, pending, deps, revoked, confirm: () => { outcome = "confirmed" } }
}

test("pending A, fresh B, restart A refresh and revoke leave B unchanged", async () => {
  const w = world()
  expect(await revokePending(request, w.deps)).toMatchObject({ exit: 0, body: { revocation: { revocationId: "revoke-A", state: "pending" } } })
  expect(w.active.get()).toBeNull()
  await w.active.port.write(B)
  w.confirm()

  const confirmed = await revokePending(request, w.deps)

  expect(confirmed).toMatchObject({ exit: 0, body: { revocation: { revocationId: "revoke-A", state: "confirmed", owner: { generation: 9 } } } })
  expect(w.active.get()).toEqual(B)
  expect(w.revoked).toEqual(["device-A", "device-A"])
  const tombstone = w.pending.get()
  expect(tombstone?.records[0]?.state).toBe("settled")
  expect(JSON.stringify(tombstone)).not.toContain("refreshToken")
  expect(JSON.stringify(tombstone)).not.toContain("PrivateKey")
  expect(await revokePending(request, { ...w.deps, active: {
    ...w.active.port, read: async () => { throw new Error("settlement replay must not read active state") },
  } })).toEqual(confirmed)
})

test.each(["accountId", "deviceId", "familyId", "ownerHandle"] as const)("existing id rejects a changed %s before reading active credentials", async field => {
  const w = world()
  await revokePending(request, w.deps)
  const result = await revokePending({ ...request, owner: { ...request.owner, [field]: "changed" } }, {
    ...w.deps, active: { ...w.active.port, read: async () => { throw new Error("active read before id resolution") } },
  })
  expect(result).toEqual({ exit: 2, body: { error: "revocation_id_conflict" } })
  expect(w.revoked).toHaveLength(1)
})

test("a second id returns the existing canonical id and creates no credential cursor", async () => {
  const w = world()
  await revokePending(request, w.deps)
  await w.active.port.write(B)
  const before = w.pending.get()

  const alias = await revokePending({ ...request, revocationId: "another-id" }, w.deps)
  expect(alias).toEqual({
    exit: 0, body: { revocation: {
      revocationId: "revoke-A", state: "pending", reason: "already_owned", owner: { ...A.owner, generation: 8 },
    } },
  })
  expect(w.pending.get()).toEqual(before)
  expect(w.active.get()).toEqual(B)
  if (alias.exit !== 0) throw new Error("Missing canonical operation")
  w.confirm()
  expect(await revokePending({
    version: 2, revocationId: alias.body.revocation.revocationId, owner: alias.body.revocation.owner,
  }, w.deps)).toMatchObject({ exit: 0, body: { revocation: { state: "confirmed", revocationId: "revoke-A" } } })
  expect(w.active.get()).toEqual(B)
})

test("a new claim against a different stable owner returns current without an obligation", async () => {
  const w = world()
  await w.active.port.write(B)
  expect(await revokePending(request, w.deps)).toEqual({ exit: 3, body: { ownerChanged: { current: B.owner } } })
  expect(w.pending.get()).toBeNull()
})

test("a newer same-family generation is accepted and an older cursor is unavailable", async () => {
  const w = world()
  await w.active.port.write(credential("A", 8))
  expect(await revokePending(request, w.deps)).toMatchObject({ exit: 0, body: { revocation: { owner: { generation: 9 } } } })
  const older = world()
  await older.active.port.write(credential("A", 6))
  expect(await revokePending(request, older.deps)).toEqual({ exit: 1, body: { error: "owner_unavailable" } })
  expect(older.pending.get()).toBeNull()
})

test("exhausted recovery stays unconfirmed and never refreshes on restart", async () => {
  const w = world()
  await expect(revokePending(request, { ...w.deps, refresh: async () => ({ state: "exhausted" }) }))
    .resolves.toMatchObject({ exit: 0, body: { revocation: { state: "pending", reason: "refresh_recovery_exhausted" } } })
  await w.active.port.write(B)
  expect(await revokePending(request, { ...w.deps, refresh: async () => { throw new Error("exhausted operation replayed") } }))
    .toMatchObject({ exit: 0, body: { revocation: { state: "pending", reason: "refresh_recovery_exhausted" } } })
  expect(w.active.get()).toEqual(B)
  expect(w.revoked).toEqual([])
})

test.each(["owned-write", "active-clear", "attempt-write", "successor-write", "confirmation-write", "matching-clear", "tombstone-write"] as const)(
  "crash at %s preserves A custody and leaves fresh B unchanged on resume", async crash => {
    const w = world()
    let writes = 0
    let clears = 0
    let crashed = false
    w.confirm()
    const boundary = new Map([
      ["owned-write", 1], ["attempt-write", 2], ["successor-write", 3],
      ["confirmation-write", 4], ["tombstone-write", 5],
    ])
    const deps = {
      ...w.deps,
      pending: { ...w.pending.port, write: async (next: Revocations) => {
        await w.pending.port.write(next)
        if (!crashed && ++writes === boundary.get(crash)) { crashed = true; throw new Error("synthetic crash") }
      } },
      active: { ...w.active.port, clear: async () => {
        await w.active.port.clear()
        if (!crashed && ++clears === (crash === "active-clear" ? 1 : crash === "matching-clear" ? 2 : -1)) {
          crashed = true; throw new Error("synthetic crash")
        }
      } },
      revoke: async (current: OwnedCredential) => {
        // A concurrent legacy-compatible active copy cannot evade the pending-store publication block.
        if (crash === "matching-clear") await w.active.port.write(current)
        return w.deps.revoke(current)
      },
    }
    await expect(revokePending(request, deps)).rejects.toThrow("synthetic crash")
    expect(crashed).toBe(true)
    const held = w.pending.get()
    expect(ownerHasPendingRevocation(held, A.owner)).toBe(crash !== "tombstone-write")
    expect(ownerHasPendingRevocation(held, B.owner)).toBe(false)
    await w.active.port.write(B)

    expect(await revokePending(request, w.deps)).toMatchObject({ exit: 0, body: { revocation: { state: "confirmed", revocationId: "revoke-A" } } })
    expect(w.active.get()).toEqual(B)
  },
)
