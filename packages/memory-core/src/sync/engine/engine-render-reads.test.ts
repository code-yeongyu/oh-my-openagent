import { afterEach, expect, spyOn, test } from "bun:test"

import * as resilient from "../../fs/resilient"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

// #12285: a cycle that lands N keys must not re-read the render records it already wrote once per
// later key. That made the first pull of a large set quadratic: every key parsed every earlier
// record, each carrying its full rendered text.

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

const RENDER_RECORD = /[/\\]omo-sync[/\\]renders[/\\][0-9a-f]+[/\\]\d{8}\.json$/

test("landing N keys in one cycle reads each render record a bounded number of times", async () => {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  const keys = Array.from({ length: 60 }, (_, i) => `notes/n-${String(i).padStart(2, "0")}.md`)
  for (const key of keys) await a.write(key, `body of ${key}\n`)
  await a.engine.runCycle()

  // The spy calls through; it only records which paths the cycle read.
  const spy = spyOn(resilient, "readFile")
  let recordReads = 0
  try {
    expect(await b.engine.runCycle()).toMatchObject({ applied: 1 })
    recordReads = spy.mock.calls.filter((call) => RENDER_RECORD.test(String(call[0]))).length
  } finally {
    spy.mockRestore()
  }

  for (const key of keys) expect(await b.read(key)).toBe(`body of ${key}\n`)
  // The cycle reads its records once when it adopts the landed renders. Re-reading them per key
  // costs N(N-1)/2 reads (1,770 here), so any linear bound separates the two shapes.
  expect(recordReads).toBeGreaterThan(0)
  expect(recordReads).toBeLessThanOrEqual(2 * keys.length)
}, GIT_TEST_TIMEOUT)
