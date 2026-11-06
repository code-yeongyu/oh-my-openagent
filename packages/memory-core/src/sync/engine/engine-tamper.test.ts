import { afterEach, expect, test } from "bun:test"

import { ACCOUNT, type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { encodePayload } from "./fake-crypto.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
}, GIT_TEST_TIMEOUT)

async function published(lines: readonly string[]) {
  const server = new FakeSyncServer()
  const a = await makeDevice(server, "a")
  const b = await makeDevice(server, "b")
  devices.push(a, b)
  for (const [i, line] of lines.entries()) {
    await a.write(`n${i}.md`, `${line}\n`)
    await a.engine.runCycle()
  }
  return { server, a, b }
}

const forged = (batchId: string, account = ACCOUNT) =>
  encodePayload(account, batchId, 0, { items: [{ key: "evil.md", ops: new TextEncoder().encode('{"adds":{"x":"evil"},"kills":[]}') }] })

async function expectNothingApplied(b: Device, refused: number) {
  expect(await b.read("evil.md")).toBeNull()
  expect(await b.syncCommits()).toEqual([])
  expect(await b.engine.state()).toMatchObject({ applied: 0, refused })
}

test("an object whose bytes do not hash to the entry's digest is refused and counted", async () => {
  const { server, b } = await published(["one"])
  server.tamperObject(1, forged(server.entries[0]?.batchId ?? ""))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 0, refused: 1 })
  await expectNothingApplied(b, 1)
}, GIT_TEST_TIMEOUT)

test("each receiver check the verifier fails refuses the entry and everything after it", async () => {
  for (const reason of ["signature", "chain_link", "epoch"] as const) {
    const { b } = await published(["one", "two"])
    b.verifier.failing.set(1, reason)
    expect(await b.engine.runCycle()).toMatchObject({ applied: 0, refused: 1 })
    expect(await b.read("n1.md")).toBeNull()
    await expectNothingApplied(b, 1)
    expect(b.verifier.refusals).toEqual([reason])
  }
}, GIT_TEST_TIMEOUT)

test("an object bound to another account or another batch is refused", async () => {
  const { server, b } = await published(["one"])
  server.rewriteEntry(1, forged(server.entries[0]?.batchId ?? "", "acc_other"))
  expect(await b.engine.runCycle()).toMatchObject({ refused: 1 })
  expect(b.verifier.refusals).toEqual(["account_binding"])
  server.rewriteEntry(1, forged("some-other-batch"))
  await b.engine.runCycle()
  expect(b.verifier.refusals).toEqual(["account_binding", "object_binding"])
  await expectNothingApplied(b, 2)
}, GIT_TEST_TIMEOUT)

test("the same (seq, batch id) arriving later with different bytes is tampering, not a duplicate", async () => {
  const { server, b } = await published(["one"])
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1 })
  const entry = server.entries[0]
  if (entry === undefined) throw new Error("no entry")
  server.replayWithBytes(1, forged(entry.batchId ?? ""))
  expect(await b.engine.runCycle()).toMatchObject({ applied: 0, refused: 1 })
  expect(await b.read("evil.md")).toBeNull()
  expect(await b.read("n0.md")).toBe("one\n")
  expect(await b.syncCommits()).toEqual(["1-1"])
}, GIT_TEST_TIMEOUT)

test("a refused entry stops the pull there; later entries wait, nothing is skipped", async () => {
  const { b } = await published(["one", "two", "three"])
  b.verifier.failing.set(2, "signature")
  expect(await b.engine.runCycle()).toMatchObject({ applied: 1, refused: 1 })
  expect([await b.read("n0.md"), await b.read("n1.md"), await b.read("n2.md")]).toEqual(["one\n", null, null])
  b.verifier.failing.clear()
  expect(await b.engine.runCycle()).toMatchObject({ applied: 2, refused: 0 })
  expect(await b.read("n2.md")).toBe("three\n")
}, GIT_TEST_TIMEOUT)

test("a header naming another batch id than the pull row is refused by the engine whatever the verifier says", async () => {
  const { b } = await published(["one"])
  const verify = b.verifier.verifyEntry.bind(b.verifier)
  b.verifier.verifyEntry = async (entry, bytes) => {
    const verdict = await verify({ ...entry, batchId: null }, bytes)
    return verdict.ok ? { ...verdict, batchId: "AAAAAAAAAAAAAAAAAAAAAA" } : verdict
  }
  expect(await b.engine.runCycle()).toMatchObject({ applied: 0, refused: 1 })
  expect(await b.engine.status()).toEqual({ kind: "paused", seq: 1, code: "object_binding" })
  await expectNothingApplied(b, 1)
}, GIT_TEST_TIMEOUT)
