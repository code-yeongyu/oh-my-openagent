import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, watch } from "node:fs"
import { tmpdir } from "node:os"
import { join, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { gatewayInboxDirectory, gatewayRootDirectory } from "./paths"
import type { GatewayStore } from "./store"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

let harness: GatewayHarness | undefined
afterEach(async () => { await harness?.dispose(); harness = undefined })
const moduleUrl = new URL("./testing/extension-lifecycle.mjs", import.meta.url).href
const bind = (session: string) => ({
  principal: "fixture",
  binding: { platform: "custom", account_id: "bot", chat_id: session, session_durable_id: session, ttl_seconds: null },
})

test("#given a blocked inbox path #when a joined enqueue commits #then the call refuses, nothing commits, and a later retry wakes", async () => {
  const h = (harness = createGatewayHarness())
  h.phantom("blocked")
  const store = h.store()
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })
  mkdirSync(join(gatewayRootDirectory(h.agentDir), "inbox"), { recursive: true })
  const blockedPath = gatewayInboxDirectory(h.agentDir, "blocked")
  writeFileSync(blockedPath, "not a directory")
  const events: unknown[] = []
  const remove = store.onEvent((event) => events.push(event))
  try {
    const refused = await store.extensionCall("alpha", "enqueuePair", [bind("blocked")])
    expect(refused).toMatchObject({ kind: "refused" })
    expect(await store.list()).toEqual([])
    expect(events.filter((event) => typeof event === "object" && event !== null && (event as { kind?: unknown }).kind === "extension_error")).toEqual([])
    rmSync(blockedPath)
    const outcome = await store.extensionCall("alpha", "enqueuePair", [bind("blocked")])
    expect(outcome).toMatchObject({ kind: "ok", value: [{ kind: "ok" }] })
    const rows = await store.list()
    expect(rows).toHaveLength(1)
    expect(readdirSync(blockedPath)).toEqual([rows[0]?.delivery_id])
  } finally { remove() }
})

test("#given an extension enqueue #when a later statement fails #then rollback removes the eagerly created wake marker", async () => {
  const h = (harness = createGatewayHarness())
  h.phantom("target")
  const store = h.store()
  await store.registerStoreExtension({ name: "alpha", moduleUrl, migrations: [] })
  const outcome = await store.extensionCall("alpha", "rollbackAfterEnqueue", bind("target"))
  expect(outcome).toMatchObject({ kind: "refused", code: "extension_operation_failed" })
  expect(await store.list()).toEqual([])
  const inbox = gatewayInboxDirectory(h.agentDir, "target")
  expect(existsSync(inbox) ? readdirSync(inbox) : []).toEqual([])
})

test("#given the afterDbCommit seam #when a joined enqueue reaches COMMIT #then its wake marker already exists", async () => {
  const agentDir = mkdtempSync(join(tmpdir(), "gateway-wake-"))
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./testing/extension-wake-driver.mjs", import.meta.url)), "commitHook", agentDir], { stdout: "pipe", stderr: "pipe" })
  const watchdog = setTimeout(() => child.kill(), 10_000)
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    const lines = stdout.trim().split("\n")
    expect(JSON.parse(lines[0] ?? "")).toEqual({ markerAtCommit: true })
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ outcome: { kind: "ok", value: [{ kind: "ok" }] } })
  } finally {
    clearTimeout(watchdog)
    if (child.exitCode === null) child.kill()
    await child.exited
    rmSync(agentDir, { recursive: true, force: true })
  }
}, 20_000)

test("#given a crash after COMMIT #when the store reopens #then the committed delivery keeps its wake marker", async () => {
  const h = (harness = createGatewayHarness())
  const agentDir = mkdtempSync(join(tmpdir(), "gateway-wake-"))
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./testing/extension-wake-driver.mjs", import.meta.url)), "crashAfterCommit", agentDir], { stdout: "pipe", stderr: "pipe" })
  const watchdog = setTimeout(() => child.kill(), 10_000)
  try {
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" })
    const reported = JSON.parse(stdout.trim().split("\n").at(-1) ?? "")
    expect(reported).toMatchObject({ outcome: { kind: "ok", value: [{ kind: "ok" }] } })
    const inbox = gatewayInboxDirectory(agentDir, "target")
    const store = h.store({ agentDir })
    try {
      const rows = await store.list()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ target_durable_id: "target", state: "queued" })
      expect(readdirSync(inbox)).toEqual([rows[0]?.delivery_id])
    } finally {
      // The reopened store's worker holds the database open; Windows refuses to remove an open file.
      await store.dispose()
      rmSync(agentDir, { recursive: true, force: true })
    }
  } finally {
    clearTimeout(watchdog)
    if (child.exitCode === null) child.kill()
    await child.exited
  }
}, 20_000)

test("#given a crash between marker and COMMIT #when the store reopens #then recovery removes the stale marker with no row", async () => {
  const h = (harness = createGatewayHarness())
  const agentDir = mkdtempSync(join(tmpdir(), "gateway-wake-"))
  const inbox = gatewayInboxDirectory(agentDir, "target")
  const inboxRoot = join(gatewayRootDirectory(agentDir), "inbox")
  mkdirSync(inboxRoot, { recursive: true })
  const markerAppeared = new Promise<string>((resolve, reject) => {
    const watcher = watch(inboxRoot, { recursive: true }, (_event, filename) => {
      if (typeof filename !== "string") return
      const name = filename.split(sep).join("/")
      if (!name.startsWith("target/") || !existsSync(join(inboxRoot, name)) || !statSync(join(inboxRoot, name)).isFile()) return
      clearTimeout(deadline)
      watcher.close()
      resolve(name)
    })
    const deadline = setTimeout(() => {
      watcher.close()
      reject(new Error("waited 10s for the joined wake marker, never appeared"))
    }, 10_000)
  })
  const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./testing/extension-wake-driver.mjs", import.meta.url)), "crashBeforeCommit", agentDir], { stdout: "pipe", stderr: "pipe" })
  const watchdog = setTimeout(() => child.kill(), 15_000)
  let store: GatewayStore | undefined
  try {
    await markerAppeared
    child.kill()
    await child.exited
    store = h.store({ agentDir })
    const self = await store.identity()
    await store.reconcile({ now: Date.now(), target_durable_id: "target", self, ledger: { pending: [], emitted: [] }, session_path: null })
    expect(await store.list()).toEqual([])
    expect(existsSync(inbox) && readdirSync(inbox).length > 0).toBe(false)
  } finally {
    clearTimeout(watchdog)
    if (child.exitCode === null) child.kill()
    await child.exited
    // The reopened store's worker holds the database open; Windows refuses to remove an open file.
    await store?.dispose()
    rmSync(agentDir, { recursive: true, force: true })
  }
}, 25_000)
