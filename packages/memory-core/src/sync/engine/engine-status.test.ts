import { afterEach, expect, test } from "bun:test"

import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

async function pair() {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  return { server, a, b }
}

test("a refused entry pauses sync at that seq with a reason code, and is retried until it passes", async () => {
  const { a, b } = await pair()
  for (const name of ["one", "two"]) {
    await a.write(`${name}.md`, `${name}\n`)
    await a.engine.runCycle()
  }
  b.verifier.failing.set(1, "signature")
  await b.engine.runCycle()
  expect(await b.engine.status()).toEqual({ kind: "paused", seq: 1, code: "signature" })
  await b.engine.runCycle()
  expect(await b.engine.status()).toEqual({ kind: "paused", seq: 1, code: "signature" })
  expect([await b.read("one.md"), await b.read("two.md")]).toEqual([null, null])
  b.verifier.failing.clear()
  await b.engine.runCycle()
  expect(await b.engine.status()).toMatchObject({ kind: "synced" })
  expect([await b.read("one.md"), await b.read("two.md")]).toEqual(["one\n", "two\n"])
}, GIT_TEST_TIMEOUT)

test("every refusal maps to a closed code; no free-text crypto detail reaches the status", async () => {
  const { server, a, b } = await pair()
  await a.write("x.md", "x\n")
  await a.engine.runCycle()
  server.tamperObject(1, new TextEncoder().encode("not the uploaded bytes"))
  await b.engine.runCycle()
  const status = await b.engine.status()
  expect(status).toEqual({ kind: "paused", seq: 1, code: "content_hash" })
  expect(Object.keys(status).sort()).toEqual(["code", "kind", "seq"])
}, GIT_TEST_TIMEOUT)

test("the status reports the last successful sync time and how many memories a catch-up updated", async () => {
  const { a, b } = await pair()
  expect(await b.engine.status()).toEqual({ kind: "never_synced" })
  for (const name of ["one", "two", "three"]) {
    await a.write(`${name}.md`, `${name}\n`)
    await a.engine.runCycle()
  }
  b.clock.advance(60_000)
  await b.engine.runCycle()
  expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now(), updatedWhileOffline: 3 })
  b.clock.advance(1_000)
  await b.engine.runCycle()
  expect(await b.engine.status()).toEqual({ kind: "synced", at: b.clock.now(), updatedWhileOffline: 0 })
}, GIT_TEST_TIMEOUT)
