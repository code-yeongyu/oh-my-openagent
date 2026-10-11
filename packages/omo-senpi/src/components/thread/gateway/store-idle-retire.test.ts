import { afterEach, expect, test } from "bun:test"
import type { Worker } from "node:worker_threads"

import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })

const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
const alpha = { name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]] }

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`waited ${ms} ms for ${what}, it never happened`)), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function signal<T>(): { readonly promise: Promise<T>; readonly fire: (value: T) => void } {
  let fire!: (value: T) => void
  const promise = new Promise<T>((resolve) => { fire = resolve })
  return { promise, fire }
}

function workerLog(): { readonly workers: Worker[]; readonly exits: Promise<number>[]; readonly onWorkerStarted: (worker: Worker) => void } {
  const workers: Worker[] = []
  const exits: Promise<number>[] = []
  return { workers, exits, onWorkerStarted: (worker) => { workers.push(worker); exits.push(new Promise<number>((resolve) => worker.once("exit", resolve))) } }
}

async function insertionOrder(store: GatewayStore): Promise<unknown> {
  return await store.extensionCall("alpha", "sql", { columns: ["id", "value"], sql: "SELECT id, value FROM alpha_items ORDER BY rowid", params: [] })
}

// Contract: an idle store holds no worker thread (the ~3 MB it retains), and the next call still works.
test("#given a store with no call in flight #when the idle interval passes #then its worker exits and the next write lands on a fresh worker that keeps the registrations", async () => {
  const h = (harness = createGatewayHarness())
  const log = workerLog()
  const retired = signal<Worker>()
  const store = h.store({ _test: { idleRetireMs: 1, onWorkerStarted: log.onWorkerStarted, onWorkerRetired: retired.fire } })
  expect(await store.registerStoreExtension(alpha)).toEqual({ kind: "ok", value: { version: 1 } })
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 1, value: "before" })).toEqual({ kind: "ok", value: { value: "before" } })

  expect(await within(retired.promise, 5_000, "the idle worker to retire")).toBe(log.workers[0] as Worker)
  await within(log.exits[0] as Promise<number>, 5_000, "the retired worker thread to exit")

  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 2, value: "after" })).toEqual({ kind: "ok", value: { value: "after" } })
  expect(await insertionOrder(store)).toEqual({ kind: "ok", value: [{ id: 1, value: "before" }, { id: 2, value: "after" }] })
  expect(log.workers.length).toBe(2)
})

// Regression a naive retire (terminating the worker without detaching it first) fails: the write made
// as the retire fires is posted to the closing worker and is lost with it.
test("#given writes before, during and after an idle retire #when the retire fires #then each write commits exactly once and in the order it was made", async () => {
  const h = (harness = createGatewayHarness())
  const log = workerLog()
  const retired = signal<Worker>()
  const during = signal<{ readonly write: ReturnType<GatewayStore["extensionCall"]> }>()
  let store!: GatewayStore
  store = h.store({
    _test: {
      idleRetireMs: 1,
      onWorkerStarted: log.onWorkerStarted,
      onWorkerRetiring: () => during.fire({ write: store.extensionCall("alpha", "put", { name: "alpha", id: 2, value: "during" }) }),
      onWorkerRetired: retired.fire,
    },
  })
  expect(await store.registerStoreExtension(alpha)).toEqual({ kind: "ok", value: { version: 1 } })
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 1, value: "before" })).toEqual({ kind: "ok", value: { value: "before" } })

  const { write: duringWrite } = await within(during.promise, 5_000, "the idle retire to start")
  expect(await within(duringWrite, 5_000, "the write made during the retire to settle")).toEqual({ kind: "ok", value: { value: "during" } })
  await within(retired.promise, 5_000, "the retired worker to finish closing")
  expect(await store.extensionCall("alpha", "put", { name: "alpha", id: 3, value: "after" })).toEqual({ kind: "ok", value: { value: "after" } })

  // `put` is a plain INSERT: a replayed write would fail on the primary key instead of being hidden.
  expect(await insertionOrder(store)).toEqual({ kind: "ok", value: [{ id: 1, value: "before" }, { id: 2, value: "during" }, { id: 3, value: "after" }] })
})

// Contract: after dispose() no worker holds the database, even one that was still retiring (a caller may remove the agent dir next).
test("#given a worker that is retiring #when the store is disposed #then dispose resolves only after that worker exited", async () => {
  const h = (harness = createGatewayHarness())
  let exited = false
  const disposal = signal<{ readonly done: Promise<void> }>()
  let store!: GatewayStore
  store = h.store({
    _test: {
      idleRetireMs: 1,
      onWorkerStarted: (worker) => { worker.once("exit", () => { exited = true }) },
      onWorkerRetiring: () => disposal.fire({ done: store.dispose() }),
    },
  })
  await store.stats()
  const { done } = await within(disposal.promise, 5_000, "the idle retire to start")
  await within(done, 5_000, "dispose to resolve")
  expect(exited).toBe(true)
})

// Reachability: a terminal whose store worker retired while it sat idle still takes a message at once.
test("#given a target session whose store worker retired #when a peer sends to it #then the message is started and applied", async () => {
  const h = (harness = createGatewayHarness())
  h.session("A")
  const retired = signal<Worker>()
  const target = h.session("B", { storeOptions: { _test: { idleRetireMs: 1, onWorkerRetired: retired.fire } } })
  await target.store.identity()
  await within(retired.promise, 5_000, "the target's idle worker to retire")

  const result = await h.get("A").engine.deliver({ sender: { kind: "session", durable_id: "A" }, target: "B", text: "after the retire" })
  await h.quiesce()

  expect(result.kind === "ok" ? result.delivery.kind : result.error.code).toBe("started")
  expect((await target.store.list({ target_durable_id: "B" })).map((row) => row.state)).toEqual(["applied"])
})
