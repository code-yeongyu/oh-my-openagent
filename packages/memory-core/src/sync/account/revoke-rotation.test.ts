// Rotation on revoke, end to end on the chain wire server (#12280; sync-design section 7). A revoke,
// `omo logout` (`DELETE /v1/devices/:id`) and the desktop sign-out (`POST /v1/session/sign-out`) all
// reach the service's revokeDevice, which freezes pushes until a remaining member rotates the
// revoked principal out. Real devices: genesis, pairing joins, CLI-shaped sessions, real engines.

import { expect, test } from "bun:test"

import { createRejectionCounter } from "../crypto/rejection.ts"
import { loadTrustAnchor } from "../crypto/trust-pin.ts"
import { GIT_TEST_TIMEOUT } from "../engine/engine-harness.test-support.ts"
import { openAccountChain } from "./account-chain.ts"
import { createAccountHttp } from "./http.ts"
import { principalOf } from "./join.ts"
import { ACCOUNT } from "./testing/genesis-enable.test-support.ts"
import { revokeWorld, within, type World, type WorldDevice } from "./testing/revoke-world.test-support.ts"

const TIMEOUT = GIT_TEST_TIMEOUT * 4

/** Whether a revoked device, with the keys it kept and the chain read outside the service gate, opens `epoch`. */
async function opensEpoch(w: World, device: WorldDevice, epoch: number): Promise<boolean> {
  const pin = await loadTrustAnchor(device.pinDir, ACCOUNT)
  if (!pin.ok) throw new Error("the revoked device kept no pin to walk from")
  const leaked = w.f.server.tokenFor(principalOf(device.keyring), `${device.serviceDeviceId}-copy`)
  const chain = await openAccountChain({
    account: ACCOUNT, anchor: pin.anchor, keyring: device.keyring, rejections: createRejectionCounter(),
    http: createAccountHttp({ baseUrl: w.f.server.url, token: () => leaked }),
  })
  return (await chain.epochKey(epoch)) !== null
}

test("R-A1 #given A and B syncing #when B is revoked #then A rotates B out, its next batch lands at epoch 2, and B's kept keys cannot open it", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const A = await w.engine(w.a)
    const B = await w.engine(b)
    await A.write("v1")
    await A.sync.engine.runCycle()
    await B.sync.engine.runCycle()
    expect(await B.read()).toContain("v1")

    expect((await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)).status).toBe(204)
    expect(w.f.server.freeze.pending).toBe(true)
    await A.write("v2 written after the revoke")
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)

    expect(w.rotations()).toEqual([[w.a.keyring.principal().id]])
    expect(w.f.server.freeze.pending).toBe(false)
    expect(w.batchEpochs().at(-1)).toBe(2)
    expect((await A.sync.status()).kind).toBe("synced")
    await expect(B.sync.engine.runCycle()).rejects.toMatchObject({ code: "device_revoked" })
    expect(await opensEpoch(w, b, 2)).toBe(false)
  } finally {
    await w.close()
  }
}, TIMEOUT)

for (const route of ["DELETE /v1/devices/:self", "POST /v1/session/sign-out"] as const) {
  test(`R-A11 #given A and B syncing #when B signs out through ${route} #then it is handled exactly like a revoke`, async () => {
    const w = await revokeWorld()
    try {
      const b = await w.join("b", 20)
      const A = await w.engine(w.a)
      await A.write("v1")
      await A.sync.engine.runCycle()
      const [method, path] = route === "POST /v1/session/sign-out" ? ["POST", "/v1/session/sign-out"] : ["DELETE", `/v1/devices/${b.serviceDeviceId}`]
      expect((await w.call(b, method, path)).ok).toBe(true)
      expect(w.f.server.freeze.pending).toBe(true)
      await A.write("v2 written after the sign-out")
      expect((await A.sync.engine.runCycle()).pushed).toBe(true)
      expect(w.rotations()).toEqual([[w.a.keyring.principal().id]])
      expect(w.batchEpochs().at(-1)).toBe(2)
      expect(await opensEpoch(w, b, 2)).toBe(false)
    } finally {
      await w.close()
    }
  }, TIMEOUT)
}

test("R-A11(c) rule 7 #given A rotated B out #when the flag stays set with no new record and no new revoke #then A appends nothing and reports flag_stuck, and a later revoke lets exactly one more rotation through", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    const A = await w.engine(w.a)
    await A.sync.engine.runCycle()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    await A.write("after B")
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    expect(w.rotations()).toHaveLength(1)

    w.f.server.freeze.setPending(true)
    const appendsBefore = w.f.server.keyAppendsReceived
    await A.write("while the flag is stuck")
    expect((await A.sync.engine.runCycle()).pushed).toBe(false)
    expect(w.f.server.keyAppendsReceived).toBe(appendsBefore)
    expect(await A.sync.status()).toMatchObject({ kind: "frozen", reason: "flag_stuck" })

    w.f.server.freeze.setPending(false)
    await w.call(w.a, "DELETE", `/v1/devices/${c.serviceDeviceId}`)
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    expect(w.rotations()).toEqual([[w.a.keyring.principal().id, c.keyring.principal().id].sort(), [w.a.keyring.principal().id]])
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A5 #given C offline with a pending edit across B's revoke and A's rotation #when C comes back #then it verifies the rotation and pushes at epoch 2", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    const A = await w.engine(w.a)
    const C = await w.engine(c)
    await C.sync.engine.runCycle()
    await C.write("written by C before it went offline")
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    await A.write("A after the revoke")
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    const epochsBefore = w.batchEpochs().length
    expect((await C.sync.engine.runCycle()).pushed).toBe(true)
    expect(w.batchEpochs().slice(epochsBefore)).toEqual([2])
    expect(w.rotations()).toHaveLength(1)
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A5 (old client) #given A runs a client without rotation on revoke #when B is revoked #then A stays frozen until upgraded C rotates, then A resumes", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    const A = await w.engine(w.a, { legacy: true })
    const C = await w.engine(c)
    await A.sync.engine.runCycle()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    await A.write("A, frozen")
    expect((await A.sync.engine.runCycle()).pushed).toBe(false)
    expect(w.rotations()).toHaveLength(0)
    await C.sync.engine.runCycle()
    expect(w.rotations()).toHaveLength(1)
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    expect(w.batchEpochs().at(-1)).toBe(2)
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A9 (idle member) #given C frozen with nothing pending and the stream up #when A's rotation is admitted #then C leaves frozen after the keyring event, with no local edit", async () => {
  const w = await revokeWorld({ stream: true })
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    let changed: (() => void) | null = null
    const C = await w.engine(c, { onStatusChange: () => changed?.() })
    const A = await w.engine(w.a)
    await A.sync.engine.runCycle()
    const frozen = Promise.withResolvers<void>()
    changed = () => void C.sync.status().then((s) => s.kind === "frozen" && frozen.resolve())
    // C cannot rotate (its device list reads fail), so it stays frozen until another member rotates.
    w.f.server.freeze.blockDeviceList(c.serviceDeviceId)
    C.sync.engine.start()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    await within(frozen.promise, "C never reported frozen after B's revoke")
    const left = Promise.withResolvers<void>()
    changed = () => void C.sync.status().then((s) => s.kind !== "frozen" && left.resolve())
    await A.write("A rotates")
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    await within(left.promise, "C stayed frozen after A's rotation was admitted")
    expect((await C.sync.status()).kind).not.toBe("frozen")
  } finally {
    await w.close()
  }
}, TIMEOUT)
