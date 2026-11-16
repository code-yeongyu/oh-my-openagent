import { expect, spyOn, test } from "bun:test"

import * as resilient from "../../fs/resilient"
import { GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

test(
  "#given a cycle blocked inside a journal write #when the device is disposed #then the cycle settles before the directory is removed",
  async () => {
    const server = new FakeSyncServer()
    const a = await makeDevice(server, "a")
    await a.write("notes/one.md", "one\n")

    const realWriteFile = resilient.writeFile
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const blocked = new Promise<void>((resolve) => {
      entered = resolve
    })
    let held = false
    const writes = spyOn(resilient, "writeFile").mockImplementation(async (file, data, options) => {
      if (!held && /[/\\]omo-sync[/\\]/.test(String(file))) {
        held = true
        entered()
        await gate
      }
      return realWriteFile(file, data, options)
    })
    // The blocked write is released by the engine being stopped, or, when teardown never stops it, once teardown is done.
    const realStop = a.engine.stop.bind(a.engine)
    const stops = spyOn(a.engine, "stop").mockImplementation(async () => {
      release()
      return realStop()
    })
    const order: string[] = []
    try {
      const cycle = a.engine.runCycle().then(
        () => order.push("cycle settled"),
        () => order.push("cycle settled"),
      )
      await blocked
      await a.dispose().then(() => order.push("disposed"))
      release()
      await cycle
    } finally {
      writes.mockRestore()
      stops.mockRestore()
    }
    expect(order).toEqual(["cycle settled", "disposed"])
  },
  GIT_TEST_TIMEOUT,
)
