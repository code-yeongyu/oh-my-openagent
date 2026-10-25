import { afterEach, expect, spyOn, test } from "bun:test"

import { StrandedGitLockError } from "../../git/repo-lock-sweep"
import { SyncAuthError, SyncHttpError, SyncNetworkError } from "./adapters/http-transport"
import { OFFLINE_SHOWN_AFTER_ATTEMPTS } from "./failure"
import { type Device, GIT_TEST_TIMEOUT, makeDevice } from "./engine-harness.test-support"
import { FakeSyncServer } from "./fake-server.test-support"

const devices: Device[] = []
afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose()
})

const failedCycle = (device: Device): Promise<unknown> => device.engine.runCycle().then(() => null, (error: unknown) => error)

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

test("a cycle stopped by a stranded git lock reports failing with the kept path and the unlock action until a cycle succeeds (omo #10637)", async () => {
  const { a, b } = await pair()
  await b.engine.runCycle()
  await a.write("one.md", "one\n")
  await a.engine.runCycle()
  const lockPath = "/memory/.git/index.lock"
  const commit = spyOn(b.repo, "commit").mockImplementation(async () => {
    throw new StrandedGitLockError([{ path: lockPath, reason: "owner-not-proven-dead" }])
  })
  const startedAt = b.clock.now()
  expect(await failedCycle(b)).toBeInstanceOf(StrandedGitLockError)
  expect(await b.engine.status()).toEqual({
    kind: "failing",
    since: startedAt,
    attempts: 1,
    failure: {
      kind: "stranded_lock",
      paths: [lockPath],
      reason: expect.any(String),
      action: expect.stringContaining(`/memory unlock ${lockPath}`),
    },
  })
  b.clock.advance(10_000)
  expect(await failedCycle(b)).toBeInstanceOf(StrandedGitLockError)
  expect(await b.engine.status()).toMatchObject({ kind: "failing", since: startedAt, attempts: 2 })
  commit.mockRestore()
  await b.engine.runCycle()
  expect(await b.engine.status()).toMatchObject({ kind: "synced", at: b.clock.now() })
  expect(await b.read("one.md")).toBe("one\n")
}, GIT_TEST_TIMEOUT)

test("an unexpected cycle error reports failing with a generic reason, never the raw error text", async () => {
  const { b } = await pair()
  const load = spyOn(b.store, "load").mockImplementation(async () => {
    throw new Error("token=secret-value at https://relay.invalid/v1/sync")
  })
  expect(String(await failedCycle(b))).toContain("secret-value")
  const status = await b.engine.status()
  expect(status).toMatchObject({ kind: "failing", attempts: 1, failure: { kind: "unknown" } })
  expect(JSON.stringify(status)).not.toContain("secret-value")
  load.mockRestore()
  await b.engine.runCycle()
  expect(await b.engine.status()).toMatchObject({ kind: "synced", at: b.clock.now() })
}, GIT_TEST_TIMEOUT)

test.each([
  ["a sign-in token that cannot be refreshed", () => new SyncAuthError(new Error("refresh refused"))],
  ["a request the server refuses as unauthorized (401)", () => new SyncHttpError("unauthorized", 401, false)],
])("%s reports failing as an expired sign-in with the sign-in action until a cycle succeeds (omo #10637)", async (_name, makeError) => {
  const { b } = await pair()
  const load = spyOn(b.store, "load").mockImplementation(async () => {
    throw makeError()
  })
  await failedCycle(b)
  expect(await b.engine.status()).toEqual({
    kind: "failing",
    since: b.clock.now(),
    attempts: 1,
    failure: { kind: "auth_expired", reason: expect.any(String), action: "Sign in to OmO again." },
  })
  load.mockRestore()
  await b.engine.runCycle()
  expect(await b.engine.status()).toMatchObject({ kind: "synced", at: b.clock.now() })
}, GIT_TEST_TIMEOUT)

test.each([
  ["an unreachable sync service", () => new SyncNetworkError(new TypeError("fetch failed"))],
  ["a sync service answering 503", () => new SyncHttpError("unavailable", 503, true)],
])("%s stays quiet while it is a blip, then reports failing as offline with the connection action, and clears on recovery (omo #10637)", async (_name, makeError) => {
  const { b } = await pair()
  await b.engine.runCycle()
  const lastGood = await b.engine.status()
  expect(lastGood).toMatchObject({ kind: "synced" })
  await b.restart()
  const load = spyOn(b.store, "load").mockImplementation(async () => {
    throw makeError()
  })
  const firstFailureAt = b.clock.now()
  for (let attempt = 1; attempt < OFFLINE_SHOWN_AFTER_ATTEMPTS; attempt += 1) {
    await failedCycle(b)
    expect(await b.engine.status()).toEqual(lastGood)
    b.clock.advance(10_000)
  }
  await failedCycle(b)
  expect(await b.engine.status()).toEqual({
    kind: "failing",
    since: firstFailureAt,
    attempts: OFFLINE_SHOWN_AFTER_ATTEMPTS,
    failure: { kind: "offline", reason: expect.any(String), action: expect.any(String) },
  })
  load.mockRestore()
  await b.engine.runCycle()
  expect(await b.engine.status()).toMatchObject({ kind: "synced", at: b.clock.now() })
}, GIT_TEST_TIMEOUT)

test("the owner hears when the shown failure appears, changes kind or clears, and never for a repeat or a hidden blip (omo #10637)", async () => {
  const server = new FakeSyncServer()
  let changes = 0
  const b = await makeDevice(server, "b", undefined, { onStatusChange: () => (changes += 1) })
  devices.push(b)
  const failWith = (makeError: () => Error) => spyOn(b.store, "load").mockImplementation(async () => {
    throw makeError()
  })
  const offline = failWith(() => new SyncNetworkError(new TypeError("fetch failed")))
  for (let attempt = 1; attempt < OFFLINE_SHOWN_AFTER_ATTEMPTS; attempt += 1) await failedCycle(b)
  expect(changes).toBe(0)
  await failedCycle(b)
  expect(changes).toBe(1)
  await failedCycle(b)
  expect(changes).toBe(1)
  offline.mockRestore()
  const locked = failWith(() => new StrandedGitLockError([{ path: "/memory/.git/index.lock", reason: "owner-not-proven-dead" }]))
  await failedCycle(b)
  expect(changes).toBe(2)
  locked.mockRestore()
  await b.engine.runCycle()
  expect(changes).toBe(3)
  await b.engine.runCycle()
  expect(changes).toBe(3)
}, GIT_TEST_TIMEOUT)

test("only a successful cycle clears a shown failure: an offline blip right after it keeps it shown and says nothing (omo #10637 review H1)", async () => {
  const server = new FakeSyncServer()
  let changes = 0
  const b = await makeDevice(server, "b", undefined, { onStatusChange: () => (changes += 1) })
  devices.push(b)
  const lockPath = "/memory/.git/index.lock"
  const failWith = (makeError: () => Error) => spyOn(b.store, "load").mockImplementation(async () => {
    throw makeError()
  })
  const locked = failWith(() => new StrandedGitLockError([{ path: lockPath, reason: "owner-not-proven-dead" }]))
  await failedCycle(b)
  expect(changes).toBe(1)
  locked.mockRestore()
  const offline = failWith(() => new SyncNetworkError(new TypeError("fetch failed")))
  await failedCycle(b)
  expect(changes).toBe(1)
  expect(await b.engine.status()).toMatchObject({ kind: "failing", failure: { kind: "stranded_lock", paths: [lockPath] } })
  offline.mockRestore()
  await b.engine.runCycle()
  expect(changes).toBe(2)
  expect(await b.engine.status()).toMatchObject({ kind: "synced" })
}, GIT_TEST_TIMEOUT)

test("a stranded lock moving to another path is a change the owner hears about, because the action names the path (omo #10637 review L1)", async () => {
  const server = new FakeSyncServer()
  let changes = 0
  const b = await makeDevice(server, "b", undefined, { onStatusChange: () => (changes += 1) })
  devices.push(b)
  for (const path of ["/memory/.git/index.lock", "/memory/.git/HEAD.lock"]) {
    const locked = spyOn(b.store, "load").mockImplementation(async () => {
      throw new StrandedGitLockError([{ path, reason: "owner-not-proven-dead" }])
    })
    await failedCycle(b)
    locked.mockRestore()
  }
  expect(changes).toBe(2)
  expect(await b.engine.status()).toMatchObject({ failure: { paths: ["/memory/.git/HEAD.lock"] } })
}, GIT_TEST_TIMEOUT)

test("a listener that throws is logged and never stalls sync: the cycle settles, nextCycle() resolves and the next cycle runs (omo #10637 review M1)", async () => {
  const server = new FakeSyncServer()
  const b = await makeDevice(server, "b", undefined, { onStatusChange: () => {
    throw new Error("listener boom")
  } })
  devices.push(b)
  const locked = spyOn(b.store, "load").mockImplementation(async () => {
    throw new StrandedGitLockError([{ path: "/memory/.git/index.lock", reason: "owner-not-proven-dead" }])
  })
  expect(await failedCycle(b)).toBeInstanceOf(StrandedGitLockError)
  locked.mockRestore()
  const waiter = b.engine.nextCycle()
  const report = await b.engine.runCycle()
  expect(await waiter).toBe(report)
  expect(await b.engine.status()).toMatchObject({ kind: "synced" })
  await b.engine.runCycle()
  expect(b.engine.cyclesRun).toBe(2)
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
