import { expect, spyOn, test } from "bun:test"

import { SyncHttpError } from "./adapters/http-transport"
import { CLIENT_UPDATE_RECHECK_MS, LOCAL_DEBOUNCE_MS } from "./engine"
import { GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

test(
  "#given the service's client floor refuses this build (426) #when local commits arrive #then no cycle starts until the paced recheck, which resumes sync once the floor lets it through (#14483)",
  async () => {
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
  },
  GIT_TEST_TIMEOUT,
)
