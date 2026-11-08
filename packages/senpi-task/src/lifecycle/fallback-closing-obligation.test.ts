import { afterEach, describe, expect, test } from "bun:test"

import { hostRunnerHarness } from "../runners/rpc-host.test-support"
import type { TaskStatus } from "../state"
import { createTaskRecordStore } from "../store"
import { cleanupProjects, tempProject } from "../manager/__fixtures__/manager-fakes"
import { createTaskLifecycle } from "./create"
import { hostLifecycleDeps } from "./__fixtures__/host-session-fakes"
import { seedRecord } from "./__fixtures__/lifecycle-fakes"

// The failed rung's child named in `fallback_closing_child` is an obligation of whoever owns the record
// next. These cases run on the production daemon probe and closer over a real socket, so a refused
// close is the adapter's real answer, not a throwing fake.

const harness = hostRunnerHarness()

afterEach(async () => {
  await harness.release()
  cleanupProjects()
})

let sequence = 0

async function crashedHandoff(status: TaskStatus, options: { readonly terminalAt?: string } = {}) {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  const host = await harness.fakeHost({ transcripts: true })
  const rpc = harness.runnerOver(host)
  sequence += 1
  const taskId = `st_${(0xeeee0000 + sequence).toString(16)}`
  const old = await rpc.start({ task_id: taskId, cwd: project, state_dir: store.stateDir, prompt: "original work", model: "test/first" })
  const [original] = host.sessions()
  if (original === undefined) throw new Error("expected the failed rung's session")
  const disconnected = host.waitForConnections(0)
  await old.dispose()
  await disconnected
  seedRecord(store, { task_id: taskId, status, execution_mode: "process", host_pid: 11_001, run_epoch: 1, spawn_spec: { version: 1, cwd: project, prompt: "original work" } })
  const closing = { host_session: { socket: host.socketPath, routing_id: original.routingId, session_path: original.sessionPath, instance_id: host.instanceId } }
  store.mutate(taskId, (record) => ({ ...record, model: "test/next", fallback_handoff_epoch: 1, fallback_closing_child: closing, ...(options.terminalAt === undefined ? {} : { terminal_at: options.terminalAt, updated_at: options.terminalAt }) }))
  const launched: string[] = []
  const { hostSessionProbe: _fakeProbe, hostSessionClose: _fakeClose, ...deps } = hostLifecycleDeps({
    store,
    hostPid: 22_002,
    isAlive: (pid) => pid === 22_002,
    respawn: async (record) => {
      launched.push(record.task_id)
      return { ok: false, disposition: "retryable", code: "respawn_failed", reason: "launch observed" }
    },
  }).deps
  return { store, host, taskId, original, closing, launched, deps }
}

describe("the failed rung's child as an obligation of the record", () => {
  test("#given the daemon refuses to reattach for the close #when the handoff is revived #then the identity is kept and no replacement launches", async () => {
    // given
    const f = await crashedHandoff("running")
    f.host.failOpen({ code: "open_failed", detail: "controlled refusal" })
    const lifecycle = createTaskLifecycle(f.deps)

    // when
    await lifecycle.reconcileOnSessionStart("other-session")

    // then
    expect(f.launched).toEqual([])
    expect(f.store.load(f.taskId)?.fallback_closing_child).toEqual(f.closing)
    lifecycle.dispose?.()
  })

  for (const scope of [undefined, "parent-1"] as const) {
    test(`#given a cancelled handoff whose parent died before the close #when ${scope === undefined ? "the global" : "the parent's"} reconcile disposes it #then the retained session is closed`, async () => {
      // given
      const f = await crashedHandoff("cancelled")
      const lifecycle = createTaskLifecycle(f.deps)

      // when
      await lifecycle.reconcileOnSessionStart(scope)

      // then
      expect(f.host.sessions()).toEqual([])
      expect(f.store.load(f.taskId)?.fallback_closing_child).toBeUndefined()
      lifecycle.dispose?.()
    })
  }

  test("#given an expired record whose own daemon session is retained #when TTL's close is refused #then the record is kept until a later sweep closes the session", async () => {
    // given
    const f = await crashedHandoff("cancelled", { terminalAt: "2000-01-01T00:00:00.000Z" })
    f.store.mutate(f.taskId, (record) => {
      const { fallback_closing_child: _moved, fallback_handoff_epoch: _ended, ...rest } = record
      return { ...rest, residency_state: "disposed", runner_kind: "host-session", host_session: f.closing.host_session }
    })
    // The production probe lists sessions without workers, so it is asked the path directly here.
    const lifecycle = createTaskLifecycle({
      ...f.deps,
      config: { ...f.deps.config, ttl_ms: 1_000 },
      hostSessionProbe: {
        daemonAlive: async () => true,
        sessionLive: async (session) => f.host.sessions().some((live) => live.sessionPath === session.session_path),
        sessionLiveness: async (session) =>
          f.host.sessions().some((live) => live.sessionPath === session.session_path) ? "live" : "gone",
        refresh: () => undefined,
      },
    })
    f.host.failOpen({ code: "open_failed", detail: "controlled refusal" })

    // when
    const refused = await lifecycle.cleanupExpiredRecords()
    f.host.failOpen(undefined)
    const retried = await lifecycle.cleanupExpiredRecords()

    // then
    expect(refused.retained).toContain(f.taskId)
    expect(retried.deleted).toContain(f.taskId)
    expect(f.host.sessions()).toEqual([])
    lifecycle.dispose?.()
  })

  test("#given TTL is closing an expired record's session #when a revival looks for the task meanwhile #then it cannot claim it, and a refused close hands the record back revivable", async () => {
    // given
    const f = await crashedHandoff("cancelled", { terminalAt: "2000-01-01T00:00:00.000Z" })
    f.store.mutate(f.taskId, (record) => {
      const { fallback_closing_child: _moved, fallback_handoff_epoch: _ended, ...rest } = record
      return { ...rest, residency_state: "rpc_detached", runner_kind: "host-session", host_session: f.closing.host_session }
    })
    const closing = Promise.withResolvers<void>()
    const refuse = Promise.withResolvers<void>()
    const lifecycle = createTaskLifecycle({
      ...f.deps,
      config: { ...f.deps.config, ttl_ms: 1_000 },
      hostSessionProbe: { daemonAlive: async () => true, sessionLive: async () => true, sessionLiveness: async () => "live", refresh: () => undefined },
      hostSessionClose: async () => {
        closing.resolve()
        await refuse.promise
        throw new Error("close refused")
      },
    })

    // when
    const sweep = lifecycle.cleanupExpiredRecords()
    await closing.promise
    const duringClose = f.store.load(f.taskId)
    refuse.resolve()
    const result = await sweep

    // then
    expect(duringClose).toBeNull()
    expect(result.retained).toContain(f.taskId)
    expect(f.store.load(f.taskId)).toMatchObject({ residency_state: "rpc_detached", host_session: f.closing.host_session })
    lifecycle.dispose?.()
  })

  test("#given an expired terminal handoff whose close is refused #when TTL sweeps #then the record is kept until a later sweep closes the child", async () => {
    // given
    const f = await crashedHandoff("cancelled", { terminalAt: "2000-01-01T00:00:00.000Z" })
    f.store.mutate(f.taskId, (record) => ({ ...record, residency_state: "disposed" }))
    const lifecycle = createTaskLifecycle({ ...f.deps, config: { ...f.deps.config, ttl_ms: 1_000 } })
    f.host.failOpen({ code: "open_failed", detail: "controlled refusal" })

    // when
    const refused = await lifecycle.cleanupExpiredRecords()
    f.host.failOpen(undefined)
    const retried = await lifecycle.cleanupExpiredRecords()

    // then
    expect(refused.retained).toContain(f.taskId)
    expect(retried.deleted).toContain(f.taskId)
    expect(f.host.sessions()).toEqual([])
    lifecycle.dispose?.()
  })
})
