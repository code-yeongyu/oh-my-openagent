import { afterEach, expect, spyOn, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import * as fs from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { withLock } from "../../locks/acquire.ts"
import { createLockRecord } from "../../locks/lock-record.ts"
import { pinTrustAnchor } from "../crypto/trust-pin.ts"
import { walk } from "../genesis/vector.test-support.ts"
import { ACCOUNT, fixture } from "./testing/genesis-enable.test-support.ts"

const cleanup: (() => void | Promise<void>)[] = []

// fs is process-global: a renameSync spy also sees other files' writes in this bun process (#11963),
// so the spies below only count, or interfere with, renames that land inside the pin directory.
const landsIn = (dir: string, to: fs.PathLike): boolean => {
  const rel = relative(dir, String(to))
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel)
}
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

for (const change of ["replacement", "aba", "refresh", "signing", "sealing"] as const) {
  test(`pin boundary serializes a sibling credential ${change} without notification`, async () => {
    const f = await fixture()
    cleanup.push(f.close)
    const verified = await walk(f.built.request, f.keyring)
    if (!verified.ok || verified.state.pin === null) throw new Error("fixture pin")
    const credentials = join(f.input.pinDir, "synthetic-credentials.json")
    writeFileSync(credentials, JSON.stringify({ identity: "A", generation: 1, token: 1, signingKey: "signing-1", sealingKey: "sealing-1" }))
    const locked = Promise.withResolvers<void>()
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "testing/credential-writer.test-support.ts"), credentials, change], {
      stdout: "inherit", stderr: "inherit",
      ipc(message) {
        if (message === "locked") locked.resolve()
      },
    })
    cleanup.push(async () => { if (child.exitCode === null) child.kill(); await child.exited })
    await Promise.race([locked.promise, child.exited.then(code => { throw new Error(`writer exited early: ${code}`) })])
    const entered = Promise.withResolvers<void>()
    const controller = new AbortController()
    let boundaries = 0
    const authority = {
      signal: controller.signal,
      admit<T>(effect: () => T): T { controller.signal.throwIfAborted(); return effect() },
      async boundary<T>(dispatch: () => T): Promise<T> {
        boundaries++
        entered.resolve()
        return withLock(`${credentials}.lock`, await createLockRecord("credential-test-pin"), async () => {
          const state = JSON.parse(readFileSync(credentials, "utf8")) as { generation: number }
          if (state.generation !== 1) throw new DOMException("Generation retired", "AbortError")
          return dispatch()
        }, { waitTimeoutMs: 10_000 })
      },
    }
    let renames = 0
    const original = fs.renameSync
    const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => { if (landsIn(f.input.pinDir, to)) renames++; original(from, to) })
    cleanup.push(() => spy.mockRestore())
    const result = pinTrustAnchor(f.input.pinDir, ACCOUNT, verified.state.pin, { authority })
    const first = await Promise.race([entered.promise.then(() => "boundary"), result.then(() => "published")])
    child.send("write")
    const writerExit = await child.exited
    expect(first).toBe("boundary")
    if (first !== "boundary") return
    if (change === "refresh") await result
    else await expect(result).rejects.toMatchObject({ name: "AbortError" })
    expect(controller.signal.aborted).toBe(false)
    expect(boundaries).toBe(1)
    expect(renames).toBe(change === "refresh" ? 1 : 0)
    expect(writerExit).toBe(0)
  }, 15_000)
}

const lockedBoundary = (credentials: string, onHeld: () => Promise<void>) => {
  const controller = new AbortController()
  const entries: number[] = []
  return {
    controller,
    entries,
    authority: {
      signal: controller.signal,
      admit<T>(effect: () => T): T { controller.signal.throwIfAborted(); return effect() },
      async boundary<T>(dispatch: () => T): Promise<T> {
        return withLock(`${credentials}.lock`, await createLockRecord("credential-test-pin"), async () => {
          const state = JSON.parse(readFileSync(credentials, "utf8")) as { generation: number }
          entries.push(state.generation)
          await onHeld()
          if (state.generation !== 1) throw new DOMException("Generation retired", "AbortError")
          return dispatch()
        }, { waitTimeoutMs: 10_000 })
      },
    },
  }
}

test("pin boundary taken first publishes once, and a sibling replacement waiting on the lock lands only after it", async () => {
  const f = await fixture()
  cleanup.push(f.close)
  const verified = await walk(f.built.request, f.keyring)
  if (!verified.ok || verified.state.pin === null) throw new Error("fixture pin")
  const credentials = join(f.input.pinDir, "synthetic-credentials.json")
  writeFileSync(credentials, JSON.stringify({ identity: "A", generation: 1, token: 1 }))
  const order: string[] = []
  const held = Promise.withResolvers<void>()
  const trying = Promise.withResolvers<void>()
  const locked = Promise.withResolvers<void>()
  const { authority, entries } = lockedBoundary(credentials, async () => { held.resolve(); await trying.promise })
  let renames = 0
  const original = fs.renameSync
  const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (landsIn(f.input.pinDir, to)) { renames++; order.push("rename") }
    original(from, to)
  })
  cleanup.push(() => spy.mockRestore())

  // given: the pin boundary holds the credential lock before the sibling writer starts
  const result = pinTrustAnchor(f.input.pinDir, ACCOUNT, verified.state.pin, { authority })
  await held.promise
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "testing/credential-writer.test-support.ts"), credentials, "replacement"], {
    stdout: "inherit", stderr: "inherit",
    ipc(message) {
      if (message === "trying") trying.resolve()
      if (message === "locked") { order.push("writer-locked"); locked.resolve() }
    },
  })
  cleanup.push(async () => { if (child.exitCode === null) child.kill(); await child.exited })

  // when: the writer is already contending for the lock while the publication proceeds,
  // and an unrelated file elsewhere in this process is renamed in the same window (#11963)
  const unrelated = await mkdtemp(join(tmpdir(), "boundary-unrelated-"))
  cleanup.push(() => rm(unrelated, { recursive: true, force: true }))
  writeFileSync(join(unrelated, "a.tmp"), "x")
  fs.renameSync(join(unrelated, "a.tmp"), join(unrelated, "a.json"))
  await result
  order.push("published")
  await locked.promise
  child.send("write")
  const writerExit = await child.exited

  // then: publication won the lock, renamed once at generation 1, and the replacement followed it
  expect(entries).toEqual([1])
  expect(renames).toBe(1)
  expect(order.indexOf("rename")).toBeLessThan(order.indexOf("writer-locked"))
  expect(JSON.parse(readFileSync(credentials, "utf8"))).toMatchObject({ identity: "B", generation: 3 })
  expect(writerExit).toBe(0)
}, 15_000)

test("an EINTR retry of the pin rename re-enters the boundary and cannot publish after the generation changed", async () => {
  const f = await fixture()
  cleanup.push(f.close)
  const verified = await walk(f.built.request, f.keyring)
  if (!verified.ok || verified.state.pin === null) throw new Error("fixture pin")
  const credentials = join(f.input.pinDir, "synthetic-credentials.json")
  writeFileSync(credentials, JSON.stringify({ identity: "A", generation: 1, token: 1 }))
  const { authority, entries, controller } = lockedBoundary(credentials, async () => undefined)
  let renames = 0
  const original = fs.renameSync
  const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (!landsIn(f.input.pinDir, to)) return original(from, to)
    renames++
    // given: the first raw rename is interrupted, and a credential replacement lands before the retry
    writeFileSync(credentials, JSON.stringify({ identity: "B", generation: 2, token: 1 }))
    throw Object.assign(new Error("interrupted"), { code: "EINTR" })
  })
  cleanup.push(() => spy.mockRestore())

  // when: the publication retries the interrupted rename
  const result = pinTrustAnchor(f.input.pinDir, ACCOUNT, verified.state.pin, { authority })

  // then: the retry re-entered the boundary, saw generation 2, and made no second rename
  await expect(result).rejects.toMatchObject({ name: "AbortError" })
  expect(entries).toEqual([1, 2])
  expect(renames).toBe(1)
  expect(controller.signal.aborted).toBe(false)
}, 15_000)
