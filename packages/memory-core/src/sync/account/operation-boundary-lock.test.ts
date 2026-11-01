import { afterEach, expect, spyOn, test } from "bun:test"
import type { Subprocess } from "bun"
import { readFileSync, writeFileSync } from "node:fs"
import * as fs from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { isAbsolute, join, relative } from "node:path"
import { settlesWithin } from "../../git/settles-within.test-support.ts"
import { withLock } from "../../locks/acquire.ts"
import { createLockRecord } from "../../locks/lock-record.ts"
import { pidAlive } from "../../locks/process-liveness.test-support.ts"
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

// #12036: an unbounded wait here once reached the 15 s test timeout, bun killed the writer, and the
// leaked `expect(...).rejects` of the timed-out body held the file open for 20 minutes. Every wait is
// therefore a named step under one deadline that ends before the test timeout, and no async matcher
// is ever left pending: a stall fails one case with the step's name and leaves nothing running.
const TEST_TIMEOUT_MS = 15_000
const STEP_BUDGET_MS = 11_000
const REAP_BOUND_MS = 2_000

class StepStalled extends Error {
  constructor(readonly step: string, state: string) {
    super(`step '${step}' did not settle before the test's step deadline (${state})`)
  }
}

const stepsWithin = (budgetMs: number, state: () => string) => {
  const deadline = Date.now() + budgetMs
  return async <T>(step: string, promise: Promise<T>): Promise<T> => {
    const settled = await settlesWithin(promise, Math.max(0, deadline - Date.now()))
    if (settled.kind === "still-waiting") throw new StepStalled(step, state())
    return settled.value
  }
}

type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }
// Handled from creation, so a promise the test stops waiting on can never surface as unhandled.
const outcomeOf = (promise: Promise<unknown>): Promise<Outcome> =>
  promise.then((): Outcome => ({ ok: true }), (error: unknown): Outcome => ({ ok: false, error }))

const writerState = (child: Subprocess | undefined) => () =>
  child === undefined ? "writer not spawned" : `writer pid ${child.pid} exitCode ${String(child.exitCode)} signal ${String(child.signalCode)} alive ${String(pidAlive(child.pid))}`

// Bounded even when the exit notification is lost: a pid that is gone counts as reaped.
const reap = async (child: Subprocess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGKILL")
  if ((await settlesWithin(child.exited, REAP_BOUND_MS)).kind === "settled" || !pidAlive(child.pid)) return
  throw new Error(`writer ${child.pid} survived SIGKILL for ${REAP_BOUND_MS} ms`)
}

const spawnWriter = (credentials: string, mode: string, onMessage: (message: unknown) => void): Subprocess => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, "testing/credential-writer.test-support.ts"), credentials, mode], {
    stdout: "inherit", stderr: "inherit", ipc: onMessage,
  })
  cleanup.push(() => reap(child))
  return child
}

const sendWrite = (child: Subprocess): void => {
  try { child.send("write") } catch (error) { throw new StepStalled("write sent", `${writerState(child)()}: ${String(error)}`) }
}

const exitedEarly = (child: Subprocess): Promise<never> => child.exited.then((code) => { throw new Error(`writer exited early: ${code}`) })

for (const change of ["replacement", "aba", "refresh", "signing", "sealing"] as const) {
  test(`pin boundary serializes a sibling credential ${change} without notification`, async () => {
    let child: Subprocess | undefined
    const step = stepsWithin(STEP_BUDGET_MS, () => writerState(child)())
    const f = await step("fixture", fixture())
    cleanup.push(f.close)
    const verified = await walk(f.built.request, f.keyring)
    if (!verified.ok || verified.state.pin === null) throw new Error("fixture pin")
    const credentials = join(f.input.pinDir, "synthetic-credentials.json")
    writeFileSync(credentials, JSON.stringify({ identity: "A", generation: 1, token: 1, signingKey: "signing-1", sealingKey: "sealing-1" }))
    const locked = Promise.withResolvers<void>()
    const written = Promise.withResolvers<void>()
    const writer = spawnWriter(credentials, change, (message) => {
      if (message === "locked") locked.resolve()
      if (message === "written") written.resolve()
    })
    child = writer
    await step("writer locked", Promise.race([locked.promise, exitedEarly(writer)]))
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
    const result = outcomeOf(pinTrustAnchor(f.input.pinDir, ACCOUNT, verified.state.pin, { authority }))
    const first = await step("boundary entry", Promise.race([entered.promise.then(() => "boundary"), result.then(() => "published")]))
    sendWrite(writer)
    await step("writer wrote", Promise.race([written.promise, exitedEarly(writer)]))
    const writerExit = await step("writer exit", writer.exited)
    expect(first).toBe("boundary")
    if (first !== "boundary") return
    const outcome = await step("pin result", result)
    if (change === "refresh") expect(outcome).toEqual({ ok: true })
    else expect(outcome.ok ? undefined : outcome.error).toMatchObject({ name: "AbortError" })
    expect(controller.signal.aborted).toBe(false)
    expect(boundaries).toBe(1)
    expect(renames).toBe(change === "refresh" ? 1 : 0)
    expect(writerExit).toBe(0)
  }, TEST_TIMEOUT_MS)
}

test("a writer that holds the lock and never writes fails the named step and leaves no writer running", async () => {
  const f = await fixture()
  cleanup.push(f.close)
  const credentials = join(f.input.pinDir, "synthetic-credentials.json")
  writeFileSync(credentials, JSON.stringify({ identity: "A", generation: 1, token: 1 }))
  const locked = Promise.withResolvers<void>()
  const written = Promise.withResolvers<void>()
  const writer = spawnWriter(credentials, "hang", (message) => {
    if (message === "locked") locked.resolve()
    if (message === "written") written.resolve()
  })
  const step = stepsWithin(5_000, writerState(writer))
  await step("writer locked", Promise.race([locked.promise, exitedEarly(writer)]))

  // given: a writer that took the lock and stalls; when: the test waits for its write under a short budget
  sendWrite(writer)
  const stalled = await stepsWithin(500, writerState(writer))("writer wrote", written.promise).then(() => null, (error: unknown) => error)

  // then: the case fails with that step's name, and reaping leaves no writer process behind
  expect(stalled).toBeInstanceOf(StepStalled)
  expect(stalled).toMatchObject({ step: "writer wrote" })
  await reap(writer)
  expect(pidAlive(writer.pid)).toBe(false)
}, TEST_TIMEOUT_MS)

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
  let child: Subprocess | undefined
  const step = stepsWithin(STEP_BUDGET_MS, () => writerState(child)())
  const f = await step("fixture", fixture())
  cleanup.push(f.close)
  const verified = await walk(f.built.request, f.keyring)
  if (!verified.ok || verified.state.pin === null) throw new Error("fixture pin")
  const credentials = join(f.input.pinDir, "synthetic-credentials.json")
  writeFileSync(credentials, JSON.stringify({ identity: "A", generation: 1, token: 1 }))
  const order: string[] = []
  const held = Promise.withResolvers<void>()
  const trying = Promise.withResolvers<void>()
  const locked = Promise.withResolvers<void>()
  const written = Promise.withResolvers<void>()
  const { authority, entries } = lockedBoundary(credentials, async () => { held.resolve(); await trying.promise })
  let renames = 0
  const original = fs.renameSync
  const spy = spyOn(fs, "renameSync").mockImplementation((from, to) => {
    if (landsIn(f.input.pinDir, to)) { renames++; order.push("rename") }
    original(from, to)
  })
  cleanup.push(() => spy.mockRestore())

  // given: the pin boundary holds the credential lock before the sibling writer starts
  const result = outcomeOf(pinTrustAnchor(f.input.pinDir, ACCOUNT, verified.state.pin, { authority }))
  await step("boundary entry", Promise.race([held.promise, result]))
  const writer = spawnWriter(credentials, "replacement", (message) => {
    if (message === "trying") trying.resolve()
    if (message === "locked") { order.push("writer-locked"); locked.resolve() }
    if (message === "written") written.resolve()
  })
  child = writer

  // when: the writer is already contending for the lock while the publication proceeds,
  // and an unrelated file elsewhere in this process is renamed in the same window (#11963)
  const unrelated = await mkdtemp(join(tmpdir(), "boundary-unrelated-"))
  cleanup.push(() => rm(unrelated, { recursive: true, force: true }))
  writeFileSync(join(unrelated, "a.tmp"), "x")
  fs.renameSync(join(unrelated, "a.tmp"), join(unrelated, "a.json"))
  expect(await step("pin result", result)).toEqual({ ok: true })
  order.push("published")
  await step("writer locked", Promise.race([locked.promise, exitedEarly(writer)]))
  sendWrite(writer)
  await step("writer wrote", Promise.race([written.promise, exitedEarly(writer)]))
  const writerExit = await step("writer exit", writer.exited)

  // then: publication won the lock, renamed once at generation 1, and the replacement followed it
  expect(entries).toEqual([1])
  expect(renames).toBe(1)
  expect(order.indexOf("rename")).toBeLessThan(order.indexOf("writer-locked"))
  expect(JSON.parse(readFileSync(credentials, "utf8"))).toMatchObject({ identity: "B", generation: 3 })
  expect(writerExit).toBe(0)
}, TEST_TIMEOUT_MS)

test("an EINTR retry of the pin rename re-enters the boundary and cannot publish after the generation changed", async () => {
  const step = stepsWithin(STEP_BUDGET_MS, () => "no writer")
  const f = await step("fixture", fixture())
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
  const outcome = await step("pin result", outcomeOf(pinTrustAnchor(f.input.pinDir, ACCOUNT, verified.state.pin, { authority })))

  // then: the retry re-entered the boundary, saw generation 2, and made no second rename
  expect(outcome.ok ? undefined : outcome.error).toMatchObject({ name: "AbortError" })
  expect(entries).toEqual([1, 2])
  expect(renames).toBe(1)
  expect(controller.signal.aborted).toBe(false)
}, TEST_TIMEOUT_MS)
