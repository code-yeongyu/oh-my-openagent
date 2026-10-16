import { afterEach, describe, expect, test } from "bun:test"
import type { Socket } from "node:net"

import { startFakeHost, type FakeHost } from "./fake-host"
import { FAKE_HOST_CAPABILITIES } from "./fake-host-probe"
import { CLEARED_OUTCOME, S1_CAPABILITIES } from "./fake-host-s1"
import { connectFakeHost } from "./fake-host-transport"

type WireRecord = Readonly<Record<string, unknown>>

interface LineClient {
  readonly records: readonly WireRecord[]
  send(command: WireRecord): Promise<WireRecord>
  next(match: (record: WireRecord) => boolean): Promise<WireRecord>
  end(): void
}

const RECORD_TIMEOUT_MS = 5_000

const hosts: FakeHost[] = []
const clients: LineClient[] = []

afterEach(async () => {
  for (const client of clients.splice(0)) client.end()
  for (const host of hosts.splice(0)) await host.stop()
})

async function s1Host(capabilities: readonly string[] = [...FAKE_HOST_CAPABILITIES, ...S1_CAPABILITIES]): Promise<FakeHost> {
  const host = await startFakeHost({ capabilities })
  hosts.push(host)
  return host
}

async function client(host: FakeHost): Promise<LineClient> {
  const socket: Socket = connectFakeHost(host.socketPath)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve())
    socket.once("error", reject)
  })
  const records: WireRecord[] = []
  const waiters: Array<{ readonly match: (record: WireRecord) => boolean; readonly resolve: (record: WireRecord) => void }> = []
  let buffer = ""
  let nextId = 1
  socket.setEncoding("utf8")
  socket.on("data", (chunk: string) => {
    buffer += chunk
    for (let newline = buffer.indexOf("\n"); newline !== -1; newline = buffer.indexOf("\n")) {
      const record: WireRecord = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      records.push(record)
      const index = waiters.findIndex(waiter => waiter.match(record))
      if (index !== -1) waiters.splice(index, 1)[0]?.resolve(record)
    }
  })
  const next = (match: (record: WireRecord) => boolean): Promise<WireRecord> => {
    const seen = records.find(match)
    if (seen !== undefined) return Promise.resolve(seen)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`waited ${RECORD_TIMEOUT_MS} ms for a matching record; saw ${JSON.stringify(records.slice(-3))}`)), RECORD_TIMEOUT_MS)
      waiters.push({ match, resolve: record => { clearTimeout(timer); resolve(record) } })
    })
  }
  const line: LineClient = {
    records,
    next,
    send: (command) => {
      const id = `c${nextId++}`
      socket.write(`${JSON.stringify({ ...command, id })}\n`)
      return next(record => record.type === "response" && record.id === id)
    },
    end: () => socket.destroy(),
  }
  clients.push(line)
  return line
}

async function openSession(rpc: LineClient, sessionPath: string, context: WireRecord = {}): Promise<string> {
  const opened = await rpc.send({ type: "open_session", sessionPath, context })
  return String(opened.sessionId)
}

describe("fake host S1 contract (senpi docs/rpc.md, 2026.10.16-2)", () => {
  test("#given a default fake host #when a client sends an S1 command #then it answers as an old host does", async () => {
    const host = await startFakeHost()
    hosts.push(host)
    const rpc = await client(host)

    const answers = await Promise.all(["subscribe_sessions", "get_effect_status", "dequeue_message", "unload_session"].map(type => rpc.send({ type })))

    for (const answer of answers) expect(answer).toMatchObject({ success: false, error: `Unknown command: ${answer.command}` })
  })

  test("#given a subscriber #when a session opens, runs and finishes #then status records ride one gap-free seq", async () => {
    const host = await s1Host()
    const watcher = await client(host)
    const driver = await client(host)
    const subscribed = await watcher.send({ type: "subscribe_sessions" })

    const sessionId = await openSession(driver, "/tmp/s1-a.jsonl")
    await driver.send({ type: "prompt", sessionId, message: "go" })
    host.completeTurn(sessionId, "done")
    const idle = await watcher.next(record => record.type === "session_status" && record.status === "idle" && record.seq === 3)

    expect(subscribed).toMatchObject({ success: true, data: { subscriptionId: "sub-1", seq: 0, snapshot: [] } })
    const statuses = watcher.records.filter(record => record.type === "session_status")
    expect(statuses.map(record => [record.seq, record.status, (record.lastChange as WireRecord).cause])).toEqual([
      [1, "idle", "open"],
      [2, "running", "prompt"],
      [3, "idle", "agent_idle"],
    ])
    expect(idle).toMatchObject({ sessionId, durableSessionId: `durable-${sessionId}`, sessionPath: "/tmp/s1-a.jsonl", attachments: 1 })
  })

  test("#given a childrenOf subscription #when sessions open #then only the parent's children match, workers and effects included", async () => {
    const host = await s1Host()
    const watcher = await client(host)
    const driver = await client(host)
    const subscribed = await watcher.send({ type: "subscribe_sessions", sessions: { childrenOf: "parent-1" } })
    expect(subscribed).toMatchObject({ success: true })

    await openSession(driver, "/tmp/s1-other.jsonl", { parent_session_id: "parent-2" })
    const child = await driver.send({ type: "open_session", sessionPath: "/tmp/s1-child.jsonl", kind: "worker", context: { parent_session_id: "parent-1" } })
    const status = await watcher.next(record => record.type === "session_status")

    expect(status).toMatchObject({ sessionId: child.sessionId, kind: "worker", seq: 1 })
    expect(watcher.records.filter(record => record.type === "session_status")).toHaveLength(1)
  })

  test("#given a running turn #when a client aborts with effectId and awaitIdle #then the answer waits for idle and agent_end names the client", async () => {
    const host = await s1Host()
    const rpc = await client(host)
    const sessionId = await openSession(rpc, "/tmp/s1-abort.jsonl")
    await rpc.send({ type: "prompt", sessionId, message: "long" })

    const abortReached = host.waitForCommand("abort")
    const answer = rpc.send({ type: "abort", sessionId, effectId: "stop-1", awaitIdle: true })
    await abortReached
    host.abortTurn(sessionId)
    const settled = await answer
    const agentEnd = await rpc.next(record => record.type === "agent_end")
    const receipt = await rpc.send({ type: "get_effect_status", sessionId, effectId: "stop-1" })

    expect(settled).toMatchObject({ success: true, data: { effectId: "stop-1", state: "done", stopped: true, idle: true } })
    expect(agentEnd).toMatchObject({ aborted: true, abortSource: "user", abortedBy: { effectId: "stop-1" } })
    expect(receipt).toMatchObject({ success: true, data: { found: true, effect: { kind: "abort", state: "done" } } })
  })

  test("#given queued input #when a client aborts with clearQueue #then each drained input with an id fails with the released outcome", async () => {
    const host = await s1Host()
    const rpc = await client(host)
    const sessionId = await openSession(rpc, "/tmp/s1-clear.jsonl")
    await rpc.send({ type: "prompt", sessionId, message: "busy" })
    const queued = await rpc.send({ type: "steer", sessionId, message: "later", clientMessageId: "m-1" })
    await rpc.send({ type: "follow_up", sessionId, message: "after" })

    const cleared = await rpc.send({ type: "abort", sessionId, clearQueue: true })
    const receipt = await rpc.send({ type: "get_effect_status", sessionId, effectId: "m-1" })
    const state = await rpc.send({ type: "get_state", sessionId })

    expect(queued).toMatchObject({ success: true, data: { disposition: "queued" } })
    expect(cleared).toMatchObject({ success: true, data: { cleared: 2 } })
    expect(receipt).toMatchObject({ data: { found: true, effect: { kind: "input", state: "failed", outcome: { kind: CLEARED_OUTCOME } } } })
    expect(state).toMatchObject({ data: { ordered: [] } })
  })

  test("#given an idle session #when steer whenIdle start arrives #then it starts a turn, and the next one queues with a removable queuedId", async () => {
    const host = await s1Host()
    const rpc = await client(host)
    const sessionId = await openSession(rpc, "/tmp/s1-idle.jsonl")

    const started = await rpc.send({ type: "steer", sessionId, message: "first", whenIdle: "start" })
    const queued = await rpc.send({ type: "follow_up", sessionId, message: "second", whenIdle: "start" })
    const before = await rpc.send({ type: "get_state", sessionId })
    const removed = await rpc.send({ type: "dequeue_message", sessionId, queuedId: "q_1", effectId: "dq-1" })
    const missing = await rpc.send({ type: "dequeue_message", sessionId, queuedId: "q_1" })

    expect(started).toMatchObject({ data: { disposition: "started" } })
    expect(queued).toMatchObject({ data: { disposition: "queued" } })
    expect(before).toMatchObject({ data: { isStreaming: true, ordered: [{ queuedId: "q_1", mode: "followUp", text: "second" }] } })
    expect(removed).toMatchObject({ data: { queuedId: "q_1", status: "removed", effect: { kind: "dequeue", state: "done", disposition: "removed" } } })
    expect(missing).toMatchObject({ data: { status: "not_found", reason: expect.any(String), action: expect.any(String) } })
  })

  test("#given a session #when unload_session is asked mid-turn and then idle #then it refuses, then parks and still answers by path", async () => {
    const host = await s1Host()
    const rpc = await client(host)
    const sessionId = await openSession(rpc, "/tmp/s1-unload.jsonl")
    await rpc.send({ type: "prompt", sessionId, message: "busy" })

    const refused = await rpc.send({ type: "unload_session", sessionId })
    host.completeTurn(sessionId, "done")
    const unloaded = await rpc.send({ type: "unload_session", sessionId, effectId: "un-1" })
    const parked = await rpc.next(record => record.type === "session_parked")
    const receipt = await rpc.send({ type: "get_effect_status", sessionPath: "/tmp/s1-unload.jsonl", effectId: "un-1" })

    expect(refused).toMatchObject({ success: true, data: { outcome: "refused", reason: "turn_active", action: expect.any(String) } })
    expect(unloaded).toMatchObject({ success: true, data: { outcome: "unloaded", sessionPath: "/tmp/s1-unload.jsonl" } })
    expect(parked).toMatchObject({ sessionId, reason: "unloaded" })
    expect(receipt).toMatchObject({ data: { found: true, effect: { kind: "unload", state: "done", disposition: "unloaded" } } })
    expect(host.sessions().find(session => session.routingId === sessionId)).toMatchObject({ parked: true })
    expect(await rpc.send({ type: "list_sessions" })).toMatchObject({ data: { sessions: [] } })
  })

  test("#given a context patch #when an unattached and an attached connection send it #then only the attached one lands", async () => {
    const host = await s1Host()
    const watcher = await client(host)
    const driver = await client(host)
    const sessionId = await openSession(driver, "/tmp/s1-context.jsonl")
    await watcher.send({ type: "subscribe_sessions", include_context: true })

    const stranger = await watcher.send({ type: "set_session_context", sessionId, patch: { task_status: "running" } })
    const hostKey = await driver.send({ type: "set_session_context", sessionId, patch: { host_socket: "x" } })
    const patched = await driver.send({ type: "set_session_context", sessionId, patch: { task_status: "running", run_epoch: 2 } })
    const status = await watcher.next(record => record.type === "session_status" && (record.lastChange as WireRecord).cause === "context")

    expect(stranger).toMatchObject({ success: false, errorCode: "session_not_attached" })
    expect(hostKey).toMatchObject({ success: false, errorCode: "invalid_session_context" })
    expect(patched).toMatchObject({ success: true })
    expect(status).toMatchObject({ context: { task_status: "running", run_epoch: 2 } })
  })
})
