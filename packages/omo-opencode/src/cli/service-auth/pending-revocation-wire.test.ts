import { expect, test } from "bun:test"
import fixture from "./fixtures/refresh-writer-v1/pending-revocation-v2.json"
import { revokePending } from "./pending-revocation"
import {
  type CredentialOwner, type OwnedCredential, type Revocations,
  revokePendingRequestSchema, revocationReplySchema,
} from "./protocol-v2"
import { grant, privateKeys } from "./test-support"

const request = revokePendingRequestSchema.parse(fixture.request)
const credential = (owner: CredentialOwner): OwnedCredential => ({
  ...grant, ...privateKeys, owner, writerFloor: 2, device: { id: owner.deviceId, name: "Fixture" },
})
function store<T>(initial: T | null) {
  let value = structuredClone(initial)
  return {
    read: async () => structuredClone(value),
    write: async (next: T) => { value = structuredClone(next) },
    clear: async () => { value = null },
  }
}
function world(activeOwner: CredentialOwner | null = request.owner) {
  const active = store(activeOwner === null ? null : credential(activeOwner))
  const pending = store<Revocations>(null)
  let confirmed = false
  let revokes = 0
  const dependencies = {
    active, pending,
    refresh: async (current: OwnedCredential, write: (next: OwnedCredential) => Promise<void>) => {
      if (current.owner.generation === request.owner.generation) {
        const next = { ...current, owner: fixture.confirmed.body.revocation.owner, refreshToken: "synthetic-successor" }
        await write(next)
        return { state: "ready" as const, credential: next }
      }
      return { state: "ready" as const, credential: current }
    },
    revoke: async () => { revokes++; return confirmed ? "confirmed" as const : "unconfirmed" as const },
  }
  return { dependencies, confirm: () => { confirmed = true }, revokes: () => revokes }
}

test("shared pending-revocation requests and successful replies retain their exact wire shape", () => {
  for (const value of [fixture.request, fixture.secondRequest, fixture.resumeRequest]) {
    expect(revokePendingRequestSchema.parse(value)).toEqual(value)
  }
  for (const value of [fixture.alreadyOwned.body, fixture.confirmed.body]) {
    expect(revocationReplySchema.parse(value)).toEqual(value)
  }
})

test("shared canonical-id fixture resumes generation 8 and leaves active B unchanged", async () => {
  const w = world()
  await revokePending(request, w.dependencies)
  const B = credential(fixture.ownerChanged.body.ownerChanged.current)
  await w.dependencies.active.write(B)
  expect(await revokePending(revokePendingRequestSchema.parse(fixture.secondRequest), w.dependencies)).toEqual(fixture.alreadyOwned)
  w.confirm()
  expect(await revokePending(revokePendingRequestSchema.parse(fixture.resumeRequest), w.dependencies)).toEqual(fixture.confirmed)
  expect(await w.dependencies.active.read()).toEqual(B)
  expect(await revokePending(request, w.dependencies)).toEqual(fixture.confirmed)
  expect(w.revokes()).toBe(2)
})

test("shared id-conflict fixture rejects another stable owner", async () => {
  const w = world()
  await revokePending(request, w.dependencies)
  expect(await revokePending({
    ...request, owner: { ...request.owner, ownerHandle: "different-owner" },
  }, w.dependencies)).toEqual(fixture.conflict)
  expect(w.revokes()).toBe(1)
})

test("shared unavailable-owner fixture does not create an obligation", async () => {
  const w = world(null)
  expect(await revokePending(request, w.dependencies)).toEqual(fixture.ownerUnavailable)
  expect(await w.dependencies.pending.read()).toBeNull()
})

test("shared owner-changed fixture returns B without claiming A", async () => {
  const w = world(fixture.ownerChanged.body.ownerChanged.current)
  expect(await revokePending(request, w.dependencies)).toEqual(fixture.ownerChanged)
  expect(await w.dependencies.pending.read()).toBeNull()
})
