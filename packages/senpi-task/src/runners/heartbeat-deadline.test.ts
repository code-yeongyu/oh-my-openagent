import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"
import { adaptRpcHandle } from "../manager/child-handle"
import { createOutcomeTracker } from "../manager/manager-outcome"
import { createTaskRecordStore } from "../store"
import { runTaskOutput } from "../tools/output/output"
import { makeRecord } from "../tools/output/__fixtures__/records"
import { baseSpec, cleanupProjects, makeManager } from "../manager/__fixtures__/manager-fakes"
import { fakeClock } from "./rpc/__fixtures__/clock"
import { silentChild } from "./rpc/__fixtures__/silent-child"
import { createRpcChildHandle } from "./rpc/handle"
import { RpcProtocolClient } from "./rpc/protocol-client"
import { createHostSessionHandle } from "./rpc-host/handle"
import { fakeSessionPort, FAKE_SESSION } from "./rpc-host/handle.test-support"
import type { HostSessionLiveness } from "./rpc-host/handle-port"

let clock: ReturnType<typeof fakeClock>
const roots: string[] = []
afterEach(() => {
  clock?.restore()
  cleanupProjects()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function harness(kind: "stdio" | "host", intervalMs = 10_000) {
  const fake = silentChild()
  const client = new RpcProtocolClient({ child: fake.child })
  const port = fakeSessionPort()
  const reads: Array<ReturnType<typeof Promise.withResolvers<HostSessionLiveness>>> = []
  let terminated = 0
  const handle = kind === "stdio"
    ? createRpcChildHandle({
        client, child: fake.child, taskId: "st_00000001", heartbeatIntervalMs: intervalMs, now: clock.now,
        terminateChild: async () => { terminated++; fake.child.emit("close", null, "SIGKILL") },
      })
    : createHostSessionHandle({
        client: { ...port, getState: () => { const read = Promise.withResolvers<HostSessionLiveness>(); reads.push(read); return read.promise } },
        session: FAKE_SESSION, taskId: "st_00000001", heartbeatIntervalMs: intervalMs, now: clock.now,
        closeGraceMs: 10, openDisposition: "attached",
      })
  return {
    handle, port,
    terminated: () => terminated,
    count: () => kind === "stdio" ? fake.commands.filter((command) => command.type === "get_state").length : reads.length,
    answer() {
      if (kind === "stdio") fake.respond()
      else reads.at(-1)!.resolve({ sessionId: "durable-child" })
    },
    emit(event: unknown) {
      if (kind === "stdio") fake.emit(event)
      else port.emitEvent(event as AgentSessionEvent)
    },
  }
}

for (const kind of ["stdio", "host"] as const) {
  test(`#given ${kind} a successful heartbeat #when task_output reads the live manager #then its snapshot includes last_seen_at`, async () => {
    clock = fakeClock()
    const h = harness(kind)
    const { manager, store } = makeManager({
      process: { start: async (spec) => ({ ...adaptRpcHandle(h.handle), task_id: spec.taskId }) },
    })
    const started = await manager.start(baseSpec({ execution_mode: "process" }))
    if (started.kind !== "started") throw new Error("expected started")
    await clock.advance(10_000)
    h.answer()
    await clock.advance(0)
    const output = await runTaskOutput({ manager, stateDir: store.stateDir }, { task_id: started.task_id }, "parent-1")
    expect(output.details).toMatchObject({ kind: "status", snapshot: { last_seen_at: "1970-01-01T00:00:10.000Z" } })
    manager.forget(started.task_id, { path: "park" })
    await h.handle.dispose()
  })

  test(`#given ${kind} pending get_state #when more heartbeat ticks occur #then the probe is single-flight`, async () => {
    clock = fakeClock()
    const h = harness(kind, 1_000)
    await clock.advance(9_000)
    expect(h.count()).toBe(1)
    h.answer()
    await clock.advance(0)
    expect(h.handle.lastSeen()).toBe(9_000)
    await h.handle.dispose()
    expect(clock.pending()).toBe(0)
  })

  test(`#given ${kind} three heartbeat misses #when the bound expires #then the record errors with transcript and action and cannot resurrect`, async () => {
    clock = fakeClock()
    const h = harness(kind)
    const root = mkdtempSync(join(tmpdir(), "heartbeat-record-"))
    roots.push(root)
    const store = createTaskRecordStore({ project_dir: root, task: { state_dir: root } })
    const record = makeRecord({ task_id: "st_00000001", status: "running", residency_state: "resident" })
    store.save(record)
    const transcript = join(root, "children", record.task_id, "sessions", "kept.jsonl")
    mkdirSync(join(root, "children", record.task_id, "sessions"), { recursive: true })
    writeFileSync(transcript, '{"type":"session","id":"kept"}\n')
    const managed = adaptRpcHandle(h.handle)
    const persisted = Promise.withResolvers<void>()
    const tracker = createOutcomeTracker({
      store, now: clock.now, liveHandle: () => managed, tryLoad: (id) => store.load(id),
      runStatsSnapshot: () => undefined, releaseSlot: () => {}, forget: () => {},
      settleWaiters: () => persisted.resolve(), tryRuntimeFallback: async () => false,
    })
    tracker.trackOutcome(record.task_id, managed, record.model, record.notification.run_epoch)
    await clock.advance(40_000)
    const waitForOutcome = h.handle.waitForOutcome
    if (waitForOutcome === undefined) throw new Error("the child handle did not expose its outcome wait")
    expect(await Promise.race([waitForOutcome(), Promise.resolve("still pending")]))
      .toMatchObject({ status: "error", failure: { kind: "child-unresponsive" } })
    await persisted.promise
    expect(store.load(record.task_id)).toMatchObject({ status: "error", failure_kind: "child-unresponsive" })
    expect(existsSync(transcript)).toBe(true)
    const output = await runTaskOutput({
      manager: { get: (id) => store.load(id) ?? undefined, list: () => store.list().records.map((record) => ({ record })) },
      stateDir: root,
    }, { task_id: record.task_id }, record.parent_session_id)
    expect(output.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: expect.stringMatching(/Action: /) })]))
    if (kind === "stdio") expect(h.terminated()).toBe(1)
    else {
      expect(h.port.detaches).toBe(1)
      expect(h.port.closes).toBe(0)
      expect(h.port.sent).toEqual([])
    }
    h.emit({ type: "agent_start" })
    h.emit({ type: "agent_end" })
    h.emit({ type: "agent_idle" })
    h.answer()
    await clock.advance(0)
    expect(store.load(record.task_id)?.status).toBe("error")
    expect(h.handle.hasExited?.()).toBe(true)
    tracker.release(record.task_id)
    await h.handle.dispose()
  })

  test(`#given ${kind} delayed answer after two misses #when it answers at 25 seconds #then the failure count resets`, async () => {
    clock = fakeClock()
    const h = harness(kind)
    await clock.advance(35_000)
    if (kind === "host") expect(h.count()).toBe(1)
    h.answer()
    await clock.advance(0)
    expect(h.handle.hasExited?.()).toBe(false)
    expect(h.handle.lastSeen()).toBe(35_000)
    await clock.advance(20_000)
    expect(h.handle.hasExited?.()).toBe(false)
    await h.handle.dispose()
  })
}
