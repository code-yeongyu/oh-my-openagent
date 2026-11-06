// Rotation on revoke under concurrency (#12280 R-A2..R-A4). Every interleaving is forced, never hoped
// for: the chain server parks the next `PUT /v1/sync/keys` after it is received and before admission,
// and the test admits the competing record first.

import { expect, test } from "bun:test"

import { GIT_TEST_TIMEOUT } from "../engine/engine-harness.test-support.ts"
import { revokeWorld, within } from "./testing/revoke-world.test-support.ts"

const TIMEOUT = GIT_TEST_TIMEOUT * 4
const ids = (...devices: { readonly keyring: { principal(): { readonly id: string } } }[]) => devices.map((d) => d.keyring.principal().id).sort()

test("R-A2 #given A and C both frozen at one head #when C's rotation is admitted while A's is parked #then A loses, adopts C's, and both push at epoch 2", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    const A = await w.engine(w.a)
    const C = await w.engine(c)
    await A.sync.engine.runCycle()
    await C.sync.engine.runCycle()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const hold = w.f.server.holdKeysAppend()
    await A.write("A, parked")
    const aCycle = A.sync.engine.runCycle()
    await within(hold.received, "A never sent its rotation")
    await C.write("C wins")
    expect((await C.sync.engine.runCycle()).pushed).toBe(true)
    hold.release()
    expect((await aCycle).pushed).toBe(true)
    expect(w.rotations()).toEqual([ids(w.a, c)])
    expect(w.batchEpochs().slice(-2)).toEqual([2, 2])
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A3(a) #given B and D revoked before A settles #then one rotation excludes both", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    const d = await w.join("d", 40)
    const A = await w.engine(w.a)
    await A.sync.engine.runCycle()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    await w.call(w.a, "DELETE", `/v1/devices/${d.serviceDeviceId}`)
    await A.write("after two revokes")
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    expect(w.rotations()).toEqual([ids(w.a, c)])
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A3(b) #given A's rotation parked after its device read #when D is revoked before admission #then the service refuses forbidden, A re-reads once and its second append excludes D", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    const d = await w.join("d", 40)
    const A = await w.engine(w.a)
    await A.sync.engine.runCycle()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const hold = w.f.server.holdKeysAppend()
    const before = w.f.server.keyAppendsReceived
    await A.write("raced by a second revoke")
    const aCycle = A.sync.engine.runCycle()
    await within(hold.received, "A never sent its rotation")
    w.f.server.freeze.revoke(d.serviceDeviceId)
    hold.release()
    expect((await aCycle).pushed).toBe(true)
    expect(w.f.server.keyAppendsReceived - before).toBe(2)
    expect(w.rotations()).toEqual([ids(w.a, c)])
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A3(c) #given A rotated B out #when D is revoked after that rotation landed #then the flag is set again and a second rotation reaches epoch 3", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const c = await w.join("c", 30)
    const d = await w.join("d", 40)
    const A = await w.engine(w.a)
    await A.sync.engine.runCycle()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    await A.write("after B")
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    await w.call(w.a, "DELETE", `/v1/devices/${d.serviceDeviceId}`)
    expect(w.f.server.freeze.pending).toBe(true)
    await A.write("after D")
    expect((await A.sync.engine.runCycle()).pushed).toBe(true)
    expect(w.rotations()).toEqual([ids(w.a, c, d), ids(w.a, c)])
    expect(w.batchEpochs().at(-1)).toBe(3)
  } finally {
    await w.close()
  }
}, TIMEOUT)

test("R-A4 #given A's rotation parked #when an approval of E is admitted first #then A gets stale_base, rebuilds from the new fold, and its rotation includes E", async () => {
  const w = await revokeWorld()
  try {
    const b = await w.join("b", 20)
    const A = await w.engine(w.a)
    await A.sync.engine.runCycle()
    await w.call(w.a, "DELETE", `/v1/devices/${b.serviceDeviceId}`)
    const hold = w.f.server.holdKeysAppend()
    await A.write("A, parked")
    const aCycle = A.sync.engine.runCycle()
    await within(hold.received, "A never sent its rotation")
    const e = await w.join("e", 50)
    hold.release()
    expect((await aCycle).pushed).toBe(true)
    expect(w.rotations()).toEqual([ids(w.a, e)])
  } finally {
    await w.close()
  }
}, TIMEOUT)
