import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { ENDPOINT_LIST_TIMEOUT_MS, TUI_REQUEST_TIMEOUT_MS } from "./live-surface"
import { publishedWorld } from "./published-endpoint-fixture"

/** A listener process killed with SIGKILL never unlinks its socket file: connects to it are refused. */
async function leaveStaleSocket(socketPath: string) {
  const child = Bun.spawn([process.execPath, "-e", `require("node:net").createServer(() => {}).listen(${JSON.stringify(socketPath)}, () => console.log("up"))`], { stdout: "pipe" })
  const reader = child.stdout.getReader()
  await reader.read()
  reader.releaseLock()
  child.kill("SIGKILL")
  await child.exited
}

const worlds: Array<Awaited<ReturnType<typeof publishedWorld>>> = []
afterEach(async () => { for (const world of worlds.splice(0)) await world.close() })
async function world() { const w = await publishedWorld(); worlds.push(w); return w }

test("registered exact-id tool send delivers without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
})

test("registered exact-id SDK send delivers without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  const result = await w.sdk.send({ thread: "target", text: "hello sdk" })
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
})

test("bound exact-id SDK send validates its target without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  const bound = await w.sdk.bind({ session: "target", binding: { platform: "custom", account_id: "bot", chat_id: "chat" } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const result = await w.sdk.send({ thread: "target", binding_id: bound.binding.binding_id, text: "hello bound" })
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
})

test("cleanly closed target queues offline without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  await target.stop()
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(w.discovery()).toBe(0)
})

test("dead published socket queues offline after the close event without discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  await target.crash()
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(target.runtime.listAdmittedDeliveries().pending).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, 10000)

test("owner killed uncleanly leaves its socket file and the send queues offline after a refused connect without discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  await target.crash()
  await leaveStaleSocket(target.socketPath)
  expect(existsSync(target.socketPath)).toBe(true)
  expect((await w.store.sessionOwner("target"))?.endpoint?.socket).toBe(target.socketPath)
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, 10000)

test("old owner late shutdown cannot erase the takeover endpoint", async () => {
  const w = await world()
  const a = await w.owner("a")
  const b = await w.owner("b")
  await a.stop()
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(b.runtime.enqueueCalls).toHaveLength(1)
  expect(a.runtime.listAdmittedDeliveries().pending).toHaveLength(0)
  expect(w.discovery()).toBe(0)
})

test("moved owner receives the send and stale socket is never dialed", async () => {
  const w = await world()
  const a = await w.owner("a")
  const b = await w.owner("b")
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(a.frames).toEqual([])
  expect(b.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
})

test("same durable id new incarnation replaces its own published record", async () => {
  const w = await world()
  const a = await w.owner("a")
  const before = await w.store.sessionOwner("target")
  await a.stop()
  const b = await w.owner("b")
  const after = await w.store.sessionOwner("target")
  expect(after?.endpoint?.socket).toBe(b.socketPath)
  expect(after?.incarnation).not.toBe(before?.incarnation)
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
})

test("foreign workspace is refused without a target entry or global discovery", async () => {
  const w = await world()
  const target = await w.owner("a", "/")
  const result = await w.send()
  expect(result).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
  expect(target.runtime.listAdmittedDeliveries().pending).toHaveLength(0)
  expect(await w.store.list()).toHaveLength(0)
  expect(w.discovery()).toBe(0)
})

test("missing metadata row preserves legacy discovery and delivery", async () => {
  const w = await world()
  const target = await w.owner("a")
  // A legacy session can answer list_sessions but never published ownership.
  await w.store.identity()
  const { Database } = await import("bun:sqlite")
  const db = new Database(`${w.dir}/gateway/gateway.sqlite`)
  db.run("DELETE FROM session_meta WHERE durable_id = ?", ["target"])
  db.close()
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBeGreaterThan(0)
})

test("a row only a delivery created keeps legacy discovery for the next send", async () => {
  const w = await world()
  const target = await w.owner("a")
  await w.store.identity()
  const { Database } = await import("bun:sqlite")
  const db = new Database(`${w.dir}/gateway/gateway.sqlite`)
  db.run("DELETE FROM session_meta WHERE durable_id = ?", ["target"])
  db.close()
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(await w.store.sessionOwner("target")).toBeNull()
  // The target is still busy with the first message: the live endpoint takes the second as a follow-up behind it.
  const second = await w.send()
  expect(second).toMatchObject({ kind: "ok", delivery: { kind: "queued" }, endpoint: { kind: "rpc_host" } })
  expect(target.runtime.enqueueCalls).toHaveLength(2)
})

test("a live owner that lists slower than 200 ms is still reached", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.listing.delayMs = 400
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
}, 10000)

test("a busy RPC owner listing slower than the terminal budget but within the RPC budget takes a send and a steer", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.runtime.beginUserTurn()
  target.listing.delayMs = 1800
  const [followUp, steer] = await Promise.all([
    w.sdk.send({ thread: "target", text: "busy followup" }),
    w.sdk.send({ thread: "target", text: "busy steer", mode: "steer", expected_turn_id: target.runtime.epoch }),
  ])
  expect(followUp).toMatchObject({ kind: "ok", delivery: { kind: "queued" }, endpoint_kind: "rpc_host" })
  expect(steer).toMatchObject({ kind: "ok", delivery: { kind: "steered" }, endpoint_kind: "rpc_host" })
  expect(target.runtime.enqueueCalls.map((call) => call.lane).sort()).toEqual(["followUp", "steer"])
  expect(target.frames.filter((frame) => frame === "wake").length).toBeGreaterThan(0)
  expect(w.discovery()).toBe(0)
}, 15000)

// The real RPC budget is the behavior under test: the listing and the send each wait it out once, concurrently.
test("published listener that never answers within the RPC budget is live_unresponsive, not dead, and completes offline", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.listing.answer = false
  const [view, sent] = await Promise.all([
    w.surface.listTarget?.("target", { socket: target.socketPath, kind: "rpc_host" }),
    w.send(),
  ])
  expect(view?.hosts).toEqual([expect.objectContaining({ socket: target.socketPath, alive: false, reason: "live_unresponsive" })])
  expect(sent).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, ENDPOINT_LIST_TIMEOUT_MS + 10_000)

test("a published owner nothing listens on is dead and its send queues offline without waiting for a listing budget", async () => {
  const w = await world()
  const target = await w.owner("a")
  await target.crash()
  await leaveStaleSocket(target.socketPath)
  const view = await w.surface.listTarget?.("target", { socket: target.socketPath, kind: "rpc_host" })
  expect(view?.hosts).toEqual([expect.objectContaining({ socket: target.socketPath, alive: false, reason: "dead" })])
  const started = performance.now()
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(performance.now() - started).toBeLessThan(TUI_REQUEST_TIMEOUT_MS)
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, 10000)

test("reused socket with a different live identity queues offline without delivery", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.listing.durableId = "unrelated"
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  expect(w.discovery()).toBe(0)
})
