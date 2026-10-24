import { expect, test } from "bun:test"
import { createCredentialAuthority, type AdoptionPort, type CredentialAuthority, type EnrollmentPort } from "./credential-authority"
import type { SealedStore } from "./keystore"
import { grant, privateKeys } from "./test-support"
import type { OwnedCredential } from "./protocol-v2"
import { RequestFailure } from "./protocol"

function memory<T>(initial: T | null) {
  let held = structuredClone(initial)
  const store: SealedStore<T> = {
    read: async () => structuredClone(held), write: async value => { held = structuredClone(value) }, clear: async () => { held = null },
  }
  return { store, value: () => structuredClone(held) }
}
const source = { ...grant, ...privateKeys }
const owner = { accountId: "account-A", deviceId: grant.device.id, familyId: "family-A", generation: 7, ownerHandle: "handle-A" }
const successor: OwnedCredential = { ...source, refreshToken: "successor", owner: { ...owner, generation: 8 }, writerFloor: 2 }

function world() {
  const legacy = memory(source)
  const state = memory<CredentialAuthority>(null)
  const claims: unknown[] = []
  let boot = "boot-A"
  const enrollment: EnrollmentPort = {
    available: async () => true,
    bootstrap: async () => ({ result: "ready", owner, authorization: "authorization-A" }),
    claim: async staged => { claims.push(structuredClone(staged)); return { result: "claimed", credential: successor } },
  }
  const adoption: AdoptionPort = { available: async () => true, approve: async () => "approved" }
  const options = {
    origin: "https://synthetic.example", legacy: legacy.store, store: state.store, enrollment, adoption,
    clock: async () => ({ wallTimeMs: 1_900_000_000_000, continuousTimeMs: 1000, bootId: boot }),
  }
  return { legacy, state, claims, options, reboot: () => { boot = "boot-B" } }
}

test("missing capability leaves v1 unchanged and creates no v2 state", async () => {
  const w = world()
  await expect(createCredentialAuthority({ ...w.options, enrollment: {
    ...w.options.enrollment, available: async () => false,
    bootstrap: async () => { throw new Error("must not send legacy token") },
  } }).ensure()).rejects.toMatchObject({ code: "service_upgrade_required" })
  expect(w.legacy.value()).toEqual(source)
  expect(w.state.value()).toBeNull()
})

test("a lost enrollment answer repeats only the original staged claim", async () => {
  const w = world()
  await expect(createCredentialAuthority({ ...w.options, enrollment: {
    ...w.options.enrollment, claim: async staged => { await w.options.enrollment.claim(staged); throw new RequestFailure(false) },
  } }).ensure()).rejects.toMatchObject({ retryable: true })
  expect(w.state.value()?.active).toBeNull()
  expect(await createCredentialAuthority(w.options).ensure()).toEqual(successor)
  expect(w.claims[1]).toEqual(w.claims[0])
  expect(w.legacy.value()).toBeNull()
})

test.each(["staged", "claimed", "active", "legacy-clear"] as const)("crash after %s respects the enrollment authority boundary", async boundary => {
  const w = world()
  let crashed = false
  const options = {
    ...w.options,
    store: { ...w.state.store, write: async (value: CredentialAuthority) => {
      await w.state.store.write(value)
      if (!crashed && (value.enrollment?.state === boundary || boundary === "active" && value.active !== null)) {
        crashed = true; throw new Error("synthetic crash")
      }
    } },
    legacy: { ...w.legacy.store, clear: async () => {
      if (boundary === "legacy-clear" && !crashed) { crashed = true; throw new Error("synthetic crash") }
      await w.legacy.store.clear()
    } },
  }
  await expect(createCredentialAuthority(options).ensure()).rejects.toThrow("synthetic crash")
  expect(crashed).toBe(true)
  const claimsBefore = w.claims.length
  expect(await createCredentialAuthority(w.options).ensure()).toEqual(successor)
  if (boundary !== "staged") expect(w.claims.length).toBe(claimsBefore)
})

test("reboot exhausts a staged enrollment without another claim", async () => {
  const w = world()
  await expect(createCredentialAuthority({ ...w.options, enrollment: {
    ...w.options.enrollment, claim: async () => { throw new RequestFailure(false) },
  } }).ensure()).rejects.toThrow()
  w.reboot()
  await expect(createCredentialAuthority(w.options).ensure()).rejects.toMatchObject({ code: "refresh_recovery_expired" })
  expect(w.claims).toHaveLength(0)
})

test("lost adoption approval resumes its original id and never consumes a fresh proof twice", async () => {
  const w = world()
  const ids: string[] = []
  const incoming = { ...successor, owner: { ...successor.owner, deviceId: "device-B", familyId: "family-B", ownerHandle: "handle-B" }, device: { id: "device-B", name: "B" } }
  await expect(createCredentialAuthority({ ...w.options, adoption: {
    available: async () => true, approve: async transaction => { ids.push(transaction.adoptionId); throw new RequestFailure(false) },
  } }).adopt(incoming, "fresh-proof", "fresh_sign_in")).rejects.toThrow()
  expect(await createCredentialAuthority({ ...w.options, adoption: {
    available: async () => true, approve: async transaction => { ids.push(transaction.adoptionId); return "already_approved" },
  } }).ensure()).toEqual(incoming)
  expect(ids).toHaveLength(2)
  expect(ids[1]).toBe(ids[0])
})

test("a delayed adoption approval cannot overwrite another active owner", async () => {
  const w = world()
  const B: OwnedCredential = { ...successor, owner: { ...owner, ownerHandle: "handle-B" } }
  await expect(createCredentialAuthority({ ...w.options, adoption: {
    available: async () => true, approve: async () => { await w.state.store.write({ version: 2, active: B }); return "approved" },
  } }).adopt(successor, "proof", "fresh_sign_in")).rejects.toMatchObject({ code: "active_owner_changed" })
  expect(w.state.value()?.active).toEqual(B)
})
