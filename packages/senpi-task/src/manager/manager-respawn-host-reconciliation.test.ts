import { appendFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { childSpec, hostRunnerHarness } from "../runners/rpc-host.test-support"
import { isHostSessionHandle } from "../runners/rpc-host"
import { createTaskRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { cleanupProjects, makeManager, tempProject } from "./__fixtures__/manager-fakes"
import { respawnManagedTask } from "./manager-respawn"

const harness = hostRunnerHarness()
afterEach(async () => { await harness.release(); cleanupProjects() })

async function detachedChild(deadline = false, aborted = false, rejectState = false) {
  const project = tempProject()
  const host = await harness.fakeHost({ transcripts: true })
  const runner = harness.runnerOver(host)
  const initial = createTaskRecord({ parent_session_id: "parent", root_session_id: "parent", depth: 1, execution_mode: "process", model: "anthropic/claude-sonnet-4-5", notify_on_terminal: false }, 0)
  // Production wiring (manager/runner.ts, manager-respawn.ts): the task record exists in the task store before the
  // first input, so input ids come from its persisted effect_seq and the respawned continuation gets the next one.
  const inputStore = createTaskRecordStore({ project_dir: project, task: { state_dir: project } })
  inputStore.save({ ...initial, status: "running", runner_kind: "host-session" })
  const spec = childSpec({ state_dir: project, task_id: initial.task_id, cwd: project, taskStoreDir: project })
  const first = await runner.start(spec)
  if (!isHostSessionHandle(first)) throw new Error("expected a host handle")
  const session = first.hostSession
  const detached = host.waitForConnections(0)
  await first.dispose()
  await detached
  host.completeTurn(session.routingId, "REAL FINAL ANSWER")
  if (aborted) appendFileSync(session.sessionPath, `${JSON.stringify({
    type: "message", id: "aborted-answer", message: { role: "assistant", stopReason: "aborted", content: [{ type: "text", text: "PARTIAL" }] },
  })}\n`)
  if (deadline) appendFileSync(session.sessionPath, `${JSON.stringify({
    type: "agent_end", aborted: true, abortSource: "system", deadline: { kind: "inactivity" },
  })}\n`)
  const { manager, store } = makeManager({ project })
  const record = {
    ...initial,
    status: "running" as const, host_pid: process.pid, runner_kind: "host-session" as const,
    spawn_spec: { version: 1 as const, cwd: project, prompt: spec.prompt },
    host_session: { socket: host.socketPath, routing_id: session.routingId, session_path: session.sessionPath, instance_id: session.instanceId },
  }
  store.save(record)
  const beforeRespawn = host.commands.length
  if (rejectState) {
    host.emitRecord(session.routingId, { type: "agent_start" })
    host.failReply("get_state", "Synthetic state read unavailable")
  }
  const result = await respawnManagedTask({
    beforeLaunch: () => undefined, record, sessionPath: session.sessionPath, stateDir: project,
    runners: { "in-process": { start: async () => { throw new Error("unused") } }, process: { start: async () => { throw new Error("unused") } } },
    rpcRunner: runner,
  })
  if (!result.ok) throw new Error(result.reason)
  return { host, result, record, manager, store, respawnCommands: host.commands.slice(beforeRespawn) }
}

describe("respawn reconciliation on the real host runner", () => {
  test("a rejected get_state preserves the attached child and arms manager tracking without input", async () => {
    const f = await detachedChild(false, false, true)
    try {
      expect(f.result.handle.kind).toBe("host-session")
      expect(f.result.handle.hasExited?.()).toBe(false)
      expect(f.host.connections).toBe(1)
      expect(f.respawnCommands.filter(command =>
        ["prompt", "steer", "follow_up", "abort", "close_session", "detach_session"].includes(command.type),
      )).toEqual([])
      expect(await f.manager.reattach(f.record, f.result.handle)).toEqual({ ok: true })
      expect(f.store.load(f.record.task_id)?.status).toBe("running")
      expect(f.store.load(f.record.task_id)?.final_response).toBeUndefined()
      f.host.failReply("get_state", undefined)
      const finished = f.manager.waitFor(f.record.task_id, { signal: AbortSignal.timeout(5_000) })
      const session = f.host.sessions()[0]
      if (session === undefined) throw new Error("missing attached session")
      f.host.completeTurn(session.routingId, "LIVE RESPAWN ANSWER")
      expect((await finished).final_response).toBe("LIVE RESPAWN ANSWER")
    } finally {
      await f.result.handle.dispose()
    }
  }, 5_000)

  test("attached idle finished tail settles the real answer without another prompt", async () => {
    const f = await detachedChild()
    expect(await f.result.handle.waitForOutcome()).toEqual({ status: "completed", finalResponse: "REAL FINAL ANSWER" })
    expect(f.host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    await f.manager.reattach(f.record, f.result.handle)
    expect((await f.manager.waitFor(f.record.task_id, { signal: AbortSignal.timeout(5_000) })).final_response).toBe("REAL FINAL ANSWER")
    expect(f.store.load(f.record.task_id)?.host_session?.adopted_entry_id).toEqual(expect.any(String))
    await f.result.handle.dispose()
  })

  // senpi#3266: an aborted turn left idle may have been stopped on purpose, so nothing is nudged; the
  // task is flagged as waiting for input and never adopts the partial text.
  test("attached idle aborted tail is flagged as waiting for input, sends no continuation and never adopts partial text", async () => {
    const f = await detachedChild(false, true)
    expect(f.result.ok ? f.result.awaitingInput : undefined).toEqual({ reason: "resumed_turn_aborted" })
    expect(f.host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    expect(f.store.load(f.record.task_id)?.final_response).toBeUndefined()
    await f.result.handle.dispose()
  })
  test("pre-S1 deadline marker interrupts the record without sending input", async () => {
    const f = await detachedChild(true)
    expect(await f.manager.reattach(f.record, f.result.handle)).toEqual({ ok: true })
    const stopped = f.store.load(f.record.task_id)
    expect(stopped?.status).toBe("interrupted")
    expect(stopped?.stop_reason).toBe("deadline")
    expect(stopped?.deadline).toEqual({ kind: "inactivity" })
    expect(stopped?.final_response).toBeUndefined()
    expect(f.host.commands.filter((command) => command.type === "prompt")).toHaveLength(1)
    const before = f.host.commands.length
    expect((await f.manager.sendToTask({ idOrName: f.record.task_id, message: "continue", callerSessionId: "parent" })).kind).toBe("revived")
    expect(f.host.commands.slice(before).filter((command) => ["steer", "follow_up", "prompt"].includes(command.type))).toHaveLength(1)
    await f.result.handle.dispose()
  })
})
