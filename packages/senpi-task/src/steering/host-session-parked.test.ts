import { afterEach, describe, expect, test } from "bun:test"

import { cleanupProjects, tempProject } from "../manager/__fixtures__/manager-fakes"
import type { ManagedChildHandle } from "../manager/child-handle"
import { createTaskRecord, type HostSessionIdentity, type TaskRecord, type TaskStatus } from "../state"
import { createTaskRecordStore } from "../store"
import { createSteeringEngine } from "./engine"
import type { SteeringPort } from "./types"

afterEach(cleanupProjects)

const IDENTITY: HostSessionIdentity = {
  socket: "/tmp/dh-fake/rpc.sock",
  routing_id: "routing-parked",
  session_path: "/tmp/dh-fake/sessions/parked.jsonl",
  instance_id: "instance-1",
}

type ParkedHarness = {
  readonly record: TaskRecord
  readonly engine: ReturnType<typeof createSteeringEngine>
  readonly reopened: string[]
  readonly delivered: string[]
}

// The parked child the daemon reopens on demand: `reviveDetached` is the lifecycle seam that does
// `open_session { sessionPath }` and hands back a live handle, which the engine then delivers to.
function parkedHarness(input: { readonly status: TaskStatus; readonly killed?: boolean; readonly daemonAlive: boolean }): ParkedHarness {
  const store = createTaskRecordStore({ project_dir: tempProject() })
  const seeded = createTaskRecord({
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "process",
    model: "anthropic/claude",
    notify_on_terminal: false,
  })
  const record: TaskRecord = {
    ...seeded,
    status: input.status,
    residency_state: "rpc_detached",
    runner_kind: "host-session",
    host_session: IDENTITY,
    ...(input.killed === true ? { killed: true } : {}),
  }
  store.save(record)
  const reopened: string[] = []
  const delivered: string[] = []
  const live = new Map<string, ManagedChildHandle>()
  const handle: ManagedChildHandle = {
    task_id: record.task_id,
    kind: "host-session",
    sessionId: "daemon-session",
    pid: undefined,
    steer: () => Promise.resolve(),
    followUp: (message) => {
      delivered.push(message)
      return Promise.resolve()
    },
    abort: () => Promise.resolve(),
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: () => Promise.resolve(),
  }
  const port: SteeringPort = {
    store,
    liveHandle: (taskId) => live.get(taskId),
    dequeuePending: () => false,
    reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
    reserveForDetachedRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
    isDaemonReachable: () => input.daemonAlive,
    reviveDetached: (taskId) => {
      reopened.push(taskId)
      store.mutate(taskId, (fresh) => ({ ...fresh, residency_state: "resident" }))
      live.set(taskId, handle)
      return Promise.resolve({ ok: true })
    },
    destruction: { destroyResidentTask: () => Promise.resolve() },
    runStatsSnapshot: () => undefined,
    now: () => Date.parse("2026-09-17T12:00:00.000Z"),
  }
  return { record, engine: createSteeringEngine(port), reopened, delivered }
}

describe("task_send to a parked daemon-hosted child", () => {
  test("#given a completed host-session child the daemon parked #when task_send targets it #then it is reopened once and the message is delivered", async () => {
    // given
    const harness = parkedHarness({ status: "completed", daemonAlive: true })

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: harness.record.task_id, message: "keep going" })

    // then
    expect(outcome.kind).toBe("revived")
    expect(harness.reopened).toEqual([harness.record.task_id])
    expect(harness.delivered).toEqual(["keep going"])
  })

  test("#given a host-session child parked mid-turn by a daemon that came back #when task_send targets it #then it revives instead of refusing as not_continuable", async () => {
    // given
    const harness = parkedHarness({ status: "running", daemonAlive: true })

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: harness.record.task_id, message: "keep going" })

    // then
    expect(outcome.kind).not.toBe("not_continuable")
    expect(harness.reopened).toEqual([harness.record.task_id])
    expect(harness.delivered).toEqual(["keep going"])
  })

  test("#given a parked host-session child that was killed #when task_send targets it #then it stays refused and is never reopened", async () => {
    // given
    const harness = parkedHarness({ status: "error", killed: true, daemonAlive: true })

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: harness.record.task_id, message: "keep going" })

    // then
    expect(outcome.kind).toBe("not_continuable")
    expect(harness.reopened).toEqual([])
  })
})
