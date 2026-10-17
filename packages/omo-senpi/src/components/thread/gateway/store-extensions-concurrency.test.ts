import { Database } from "bun:sqlite"
import { afterEach, expect, test } from "bun:test"
import { fork } from "node:child_process"
import { fileURLToPath } from "node:url"

import { gatewayDatabasePath } from "./paths"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/store-extension.mjs", import.meta.url).href
const descriptor = { name: "alpha", moduleUrl, migrations: [["CREATE TABLE alpha_items (id INTEGER PRIMARY KEY, value TEXT)"]] }

test("#given two processes released together #when ensuring the same extension #then each migration applies exactly once", async () => {
  const h = (harness = createGatewayHarness())
  await h.store().identity()
  const racers = [0, 1].map(() => {
    const child = fork(fileURLToPath(new URL("./testing/extension-racer.ts", import.meta.url)), [h.agentDir, moduleUrl], { execPath: process.execPath, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true })
    let output = ""
    let stderr = ""
    child.stdout?.on("data", (chunk) => { output += chunk.toString() })
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString() })
    const ready = new Promise<void>((resolve, reject) => {
      child.once("message", () => resolve())
      child.once("error", reject)
      child.once("exit", () => reject(new Error(`racer exited before ready: ${stderr}`)))
    })
    const exited = new Promise<number | null>((resolve, reject) => { child.once("exit", resolve); child.once("error", reject) })
    return { child, ready, exited, output: () => output, stderr: () => stderr }
  })
  const timeout = setTimeout(() => { for (const racer of racers) racer.child.kill("SIGKILL") }, 20_000)
  try {
    await Promise.all(racers.map((racer) => racer.ready))
    for (const racer of racers) racer.child.send("go")
    expect(await Promise.all(racers.map((racer) => racer.exited))).toEqual([0, 0])
    for (const racer of racers) expect(JSON.parse(racer.output())).toEqual({ kind: "ok", value: { version: 2 } })
    const db = new Database(gatewayDatabasePath(h.agentDir), { readonly: true })
    try {
      expect(db.query("SELECT * FROM racing_items").all()).toEqual([{ id: 1, value: "once-next" }])
      expect(db.query("SELECT version FROM extension_schema WHERE name = 'racing'").get()).toEqual({ version: 2 })
    } finally { db.close() }
  } finally {
    clearTimeout(timeout)
    for (const racer of racers) if (racer.child.exitCode === null) racer.child.kill("SIGKILL")
    await Promise.all(racers.map((racer) => racer.exited))
  }
}, 30_000)

test("#given a held writer lock #when registering then calling #then refusal is bounded and lazy ensure retries on the live worker", async () => {
  const h = (harness = createGatewayHarness())
  const store = h.store({ _test: { busyTimeoutMs: 10, lockWaitMaxMs: 60 } })
  await store.identity()
  const db = new Database(gatewayDatabasePath(h.agentDir))
  db.exec("BEGIN IMMEDIATE")
  const waits: number[] = []
  const unsubscribe = store.onEvent((event) => { if (event.kind === "lock_wait_exceeded") waits.push(event.waited_ms) })
  try {
    const registered = await store.registerStoreExtension(descriptor)
    expect(registered).toMatchObject({ kind: "refused", code: "gateway_lock_wait_exceeded", message: expect.any(String) })
    expect(await store.list()).toEqual([])
    const called = await store.extensionCall("alpha", "rows", { name: "alpha" })
    expect(called).toMatchObject({ kind: "refused", code: "gateway_lock_wait_exceeded" })
    expect(await store.journalMode()).toBe("wal")
    expect(waits).toHaveLength(2)
    for (const elapsed of waits) expect(elapsed).toBeLessThan(1000)
  } finally {
    unsubscribe()
    db.exec("ROLLBACK")
    db.close()
  }
  expect(await store.extensionCall("alpha", "rows", { name: "alpha" })).toEqual({ kind: "ok", value: [] })
}, 5000)
