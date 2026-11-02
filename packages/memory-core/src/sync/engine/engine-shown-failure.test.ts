import { expect, spyOn, test } from "bun:test"

import { StrandedGitLockError } from "../../git/repo-lock-sweep"
import { SyncNetworkError } from "./adapters/http-transport"
import { GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

test.each([1, 2])("a shown lock failure keeps its history across %i hidden offline cycles (omo #11053)", async (blips) => {
  // given
  let changes = 0
  const device = await makeDevice(new FakeSyncServer(), "b", undefined, { onStatusChange: () => (changes += 1) })
  const lock = new StrandedGitLockError([{ path: "/memory/.git/index.lock", reason: "owner-not-proven-dead" }])
  let error: Error = lock
  const load = spyOn(device.store, "load").mockImplementation(async () => { throw error })
  const fail = async () => {
    await expect(device.engine.runCycle()).rejects.toBe(error)
  }
  try {
    const since = device.clock.now()
    await fail()
    device.clock.advance(10_000)
    await fail()
    expect(await device.engine.status()).toMatchObject({ kind: "failing", since, attempts: 2 })

    // when
    error = new SyncNetworkError(new TypeError("fetch failed"))
    for (let attempt = 0; attempt < blips; attempt += 1) {
      device.clock.advance(10_000)
      await fail()
    }
    expect(await device.engine.status()).toMatchObject({ kind: "failing", since, attempts: 2 })
    error = lock
    device.clock.advance(10_000)
    await fail()

    // then
    expect(await device.engine.status()).toMatchObject({
      kind: "failing", since, attempts: 3, failure: { kind: "stranded_lock", paths: lock.paths },
    })
    device.clock.advance(10_000)
    await fail()
    expect(await device.engine.status()).toMatchObject({ kind: "failing", since, attempts: 4 })
    expect(changes).toBe(1)

    load.mockRestore()
    await device.engine.runCycle()
    expect(await device.engine.status()).toMatchObject({ kind: "synced" })
    expect(changes).toBe(2)
  } finally {
    load.mockRestore()
    await device.dispose()
  }
}, GIT_TEST_TIMEOUT)
