import { expect, spyOn, test } from "bun:test"

import { SyncHttpError } from "./adapters/http-transport"
import { CLIENT_UPDATE_RECHECK_MS, LOCAL_DEBOUNCE_MS } from "./engine"
import { makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

test("#given the service's client floor refuses this build (426) #when local commits arrive #then no cycle starts until the paced recheck, which resumes sync once the floor lets it through (#14483)", async () => {
  // given
  const device = await makeDevice(new FakeSyncServer(), "a")
  const floored = new SyncHttpError("client_update_required", 426, false)
  const load = spyOn(device.store, "load").mockImplementation(async () => {
    throw floored
  })
  try {
    const first = device.engine.nextCycle()
    device.engine.start()
    await expect(first).rejects.toBe(floored)
    expect(await device.engine.status()).toMatchObject({
      kind: "failing",
      failure: { kind: "client_update_required" },
    })
    const refusedCycles = load.mock.calls.length

    // when
    await device.write("x.md", "x\n")
    device.engine.notifyLocalCommit()
    device.clock.advance(LOCAL_DEBOUNCE_MS)
    device.engine.notifyLocalCommit()
    device.clock.advance(CLIENT_UPDATE_RECHECK_MS - LOCAL_DEBOUNCE_MS - 1)

    // then
    expect(load.mock.calls.length).toBe(refusedCycles)
    load.mockRestore()
    const rechecked = device.engine.nextCycle()
    device.clock.advance(1)
    await rechecked
    expect(await device.engine.status()).toMatchObject({ kind: "synced" })
  } finally {
    load.mockRestore()
    await device.engine.stop()
    await device.dispose()
  }
})

test("#given a floored cycle still in flight #when stop() runs #then the failed cycle arms no recheck timer after the stop (#14483 review L1)", async () => {
  // given
  const device = await makeDevice(new FakeSyncServer(), "a")
  const floored = new SyncHttpError("client_update_required", 426, false)
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const load = spyOn(device.store, "load").mockImplementation(async () => {
    await gate
    throw floored
  })
  const after = spyOn(device.clock, "after")
  try {
    const cycle = device.engine.nextCycle()
    device.engine.start()

    // when
    const stopped = device.engine.stop()
    release()
    await expect(cycle).rejects.toBe(floored)
    await stopped

    // then
    expect(after.mock.calls.filter(([ms]) => ms === CLIENT_UPDATE_RECHECK_MS)).toHaveLength(0)
  } finally {
    after.mockRestore()
    load.mockRestore()
    await device.dispose()
  }
})
