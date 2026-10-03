import { afterEach, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { ENDPOINT_LIST_TIMEOUT_MS } from "./live-surface"
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
}, 15000)

test("registered exact-id send to a terminal owner delivers without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a", undefined, "target", true)
  const tool = await w.send()
  expect(tool).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  const sdk = await w.sdk.send({ thread: "target", text: "hello sdk" })
  expect(sdk).toMatchObject({ kind: "ok" })
  expect(target.runtime.enqueueCalls).toHaveLength(2)
  expect(w.discovery()).toBe(0)
}, 15000)

test("registered exact-id SDK send delivers without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  const result = await w.sdk.send({ thread: "target", text: "hello sdk" })
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
}, 15000)

test("bound exact-id SDK send validates its target without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  const bound = await w.sdk.bind({ session: "target", binding: { platform: "custom", account_id: "bot", chat_id: "chat" } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  const result = await w.sdk.send({ thread: "target", binding_id: bound.binding.binding_id, text: "hello bound" })
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
}, 15000)

test("cleanly closed target queues offline without global discovery", async () => {
  const w = await world()
  const target = await w.owner("a")
  await target.stop()
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(w.discovery()).toBe(0)
}, 15000)

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
}, 15000)

test("moved owner receives the send and stale socket is never dialed", async () => {
  const w = await world()
  const a = await w.owner("a")
  const b = await w.owner("b")
  const result = await w.send()
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(a.frames).toEqual([])
  expect(b.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
}, 15000)

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
}, 15000)

test("foreign workspace is refused without a target entry or global discovery", async () => {
  const w = await world()
  const target = await w.owner("a", "/")
  const result = await w.send()
  expect(result).toMatchObject({ kind: "error", error: { code: "scope_denied" } })
  expect(target.runtime.listAdmittedDeliveries().pending).toHaveLength(0)
  expect(await w.store.list()).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, 15000)

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
}, 15000)

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
}, 15000)

test("a live owner that lists slower than 200 ms is still reached", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.listing.delayMs = 400
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "started" } })
  expect(target.runtime.enqueueCalls).toHaveLength(1)
  expect(w.discovery()).toBe(0)
}, 10000)

/** One thread_list, one auto send and one steer at the same owner, issued together as a caller would. */
async function listSendSteer(w: Awaited<ReturnType<typeof publishedWorld>>, target: Awaited<ReturnType<Awaited<ReturnType<typeof publishedWorld>>["owner"]>>) {
  const [list, send, steer] = await Promise.all([
    w.sdk.list({}),
    w.sdk.send({ thread: "target", text: "busy followup" }),
    w.sdk.send({ thread: "target", text: "busy steer", mode: "steer", expected_turn_id: target.runtime.epoch }),
  ])
  const listed = list.kind === "ok" && "threads" in list ? (list.threads as ReadonlyArray<{ readonly thread_id: string; readonly alive?: boolean }>).find((thread) => thread.thread_id === "target") : undefined
  return { listed, send, steer }
}

test("a busy RPC owner that lists after 1.8 s is live to thread_list, send and steer alike", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.runtime.beginUserTurn()
  target.listing.delayMs = 1800
  const { listed, send, steer } = await listSendSteer(w, target)
  expect(listed).toMatchObject({ alive: true })
  expect(send).toMatchObject({ kind: "ok", endpoint_kind: "rpc_host", delivery: { kind: "queued" } })
  expect(steer).toMatchObject({ kind: "ok", endpoint_kind: "rpc_host", delivery: { kind: "steered" } })
  expect(target.runtime.enqueueCalls.map((call) => call.lane).sort()).toEqual(["followUp", "steer"])
}, 15000)

test("a published listener that never answers is not live to thread_list, send or steer, and nothing is delivered", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.runtime.beginUserTurn()
  target.listing.answer = false
  const { listed, send, steer } = await listSendSteer(w, target)
  expect(listed?.alive).not.toBe(true)
  expect(send).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(steer).toMatchObject({ kind: "error", error: { code: "turn_conflict" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
}, 30000)

test("a dead owner whose connects are refused is offline to send and steer without waiting out the listing budget", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.runtime.beginUserTurn()
  await target.crash()
  await leaveStaleSocket(target.socketPath)
  const started = performance.now()
  const [send, steer] = await Promise.all([
    w.send(),
    w.sdk.send({ thread: "target", text: "steer the dead", mode: "steer", expected_turn_id: target.runtime.epoch }),
  ])
  expect(performance.now() - started).toBeLessThan(ENDPOINT_LIST_TIMEOUT_MS)
  expect(send).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(steer).toMatchObject({ kind: "error", error: { code: "turn_conflict" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, 15000)

test("reused socket with a different live identity queues offline without delivery", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.listing.durableId = "unrelated"
  expect(await w.send()).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, 15000)

test("a slow reused socket with a different identity never receives the target's send or steer", async () => {
  const w = await world()
  const target = await w.owner("a")
  target.runtime.beginUserTurn()
  target.listing.durableId = "unrelated"
  target.listing.delayMs = 1800
  const [send, steer] = await Promise.all([
    w.send(),
    w.sdk.send({ thread: "target", text: "steer the stranger", mode: "steer", expected_turn_id: target.runtime.epoch }),
  ])
  expect(send).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(steer).toMatchObject({ kind: "error", error: { code: "turn_conflict" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  expect(w.discovery()).toBe(0)
}, 15000)

test("a terminal the engine still reports dead is offline to thread_list, send and steer alike inside the verdict window, and nothing is admitted", async () => {
  const w = await world()
  const target = await w.owner("a", undefined, "target", true)
  await w.owner("spectator", undefined, "spectator")
  target.runtime.beginUserTurn()
  // The engine probed the terminal while it was suspended and cached alive:false; the verdict is the
  // authority for the whole enumeration-cache window, even though the socket answers again below.
  w.setVerdict(target.socketPath, { alive: false, reason: "live_unresponsive", paths: [target.sessionPath] })
  const listed = async () => {
    const result = await w.sdk.list({})
    if (result.kind !== "ok" || !("threads" in result)) throw new Error(`expected a thread list, got ${JSON.stringify(result)}`)
    return (result.threads as ReadonlyArray<{ readonly thread_id: string; readonly alive?: boolean; readonly error_note?: string }>).find((thread) => thread.thread_id === "target")
  }
  const before = await listed()
  const [send, steer] = await Promise.all([
    w.sdk.send({ thread: "target", text: "busy followup" }),
    w.sdk.send({ thread: "target", text: "busy steer", mode: "steer", expected_turn_id: target.runtime.epoch }),
  ])
  const after = await listed()
  expect(before).toMatchObject({ alive: false, error_note: "live_unresponsive" })
  expect(after).toMatchObject({ alive: false, error_note: "live_unresponsive" })
  expect(send).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(steer).toMatchObject({ kind: "error", error: { code: "turn_conflict" } })
  expect(target.runtime.enqueueCalls).toHaveLength(0)
  // The verdict stands: a cached-dead terminal is never re-dialed inside the window, even to send.
  expect(target.frames.filter((frame) => frame === "list_sessions")).toHaveLength(0)
}, 15000)

test("a bound send to a never-answering owner settles within one listing budget", async () => {
  const w = await world()
  const target = await w.owner("a")
  const bound = await w.sdk.bind({ session: "target", binding: { platform: "custom", account_id: "bot", chat_id: "chat" } })
  if (bound.kind !== "ok") throw new Error(JSON.stringify(bound))
  target.listing.answer = false
  const started = performance.now()
  const result = await w.sdk.send({ thread: "target", binding_id: bound.binding.binding_id, text: "hello bound" })
  expect(result).toMatchObject({ kind: "ok", delivery: { kind: "queued_offline" } })
  expect(performance.now() - started).toBeLessThan(ENDPOINT_LIST_TIMEOUT_MS * 1.5)
}, 30000)
