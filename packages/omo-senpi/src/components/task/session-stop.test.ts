import { describe, expect, it } from "bun:test"

import type { CancelOutcome, ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import type { CommandManager } from "./commands"
import { registerTaskSessionStop } from "./session-stop"

function record(overrides: Partial<TaskRecord> & { task_id: string; status: TaskStatus }): TaskRecord {
  return {
    parent_session_id: "session-a",
    root_session_id: "session-a",
    depth: 0,
    execution_mode: "in-process",
    model: "anthropic/claude-sonnet-4-6",
    residency_state: "persisted_only",
    created_at: "2026-07-07T00:00:00.000Z",
    updated_at: "2026-07-07T00:00:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: false,
    ...overrides,
  }
}

function manager(records: readonly TaskRecord[], outcomes: Record<string, CancelOutcome["kind"]> = {}) {
  const cancelled: string[] = []
  const fake: CommandManager = {
    list: (scope) =>
      records
        .filter((rec) => scope.scope === "all" || rec.parent_session_id === scope.session_id)
        .map((rec): ListedTask => ({ record: rec })),
    cancelTask: (taskId) => {
      cancelled.push(taskId)
      const kind = outcomes[taskId] ?? "cancelled"
      const outcome: CancelOutcome =
        kind === "cancel_pending"
          ? { kind, task_id: taskId, previous_status: "running", reason: "host unreachable" }
          : kind === "released"
            ? { kind, task_id: taskId, status: "completed" }
            : { kind: "cancelled", task_id: taskId, previous_status: "running" }
      return Promise.resolve(outcome)
    },
  }
  return { fake, cancelled }
}

const ctx = (sessionId: string) => ({ sessionManager: { getSessionId: () => sessionId } })

describe("task session stop (oh-my-openagent#14390)", () => {
  it("#given running, waiting and resident finished children #when session_stop fires #then every one is ended and reported, and a child of another session or a released one is left alone", async () => {
    const { fake, cancelled } = manager(
      [
        record({ task_id: "st_run", status: "running", name: "fix-login" }),
        record({ task_id: "st_wait", status: "pending" }),
        record({ task_id: "st_kept", status: "completed", residency_state: "resident" }),
        record({ task_id: "st_done", status: "completed" }),
        record({ task_id: "st_other", status: "running", parent_session_id: "session-b", root_session_id: "session-b" }),
      ],
      { st_kept: "released" },
    )
    const pi = new FakeExtensionAPI()
    registerTaskSessionStop(pi, fake)

    const [report] = await pi.dispatch("session_stop", { type: "session_stop", requestedBy: "user" }, ctx("session-a"))

    expect(cancelled).toEqual(["st_run", "st_wait", "st_kept"])
    expect(report).toEqual({
      stopped: [
        { kind: "child", id: "st_run", label: "fix-login" },
        { kind: "child", id: "st_wait", label: "st_wait" },
        { kind: "child", id: "st_kept", label: "st_kept" },
      ],
      failed: [],
    })
  })

  it("#given a child whose host is unreachable #when session_stop fires #then it is reported as failed with the reason", async () => {
    const { fake } = manager([record({ task_id: "st_far", status: "running" })], { st_far: "cancel_pending" })
    const pi = new FakeExtensionAPI()
    registerTaskSessionStop(pi, fake)

    const [report] = await pi.dispatch("session_stop", { type: "session_stop", requestedBy: "agent" }, ctx("session-a"))

    expect(report).toMatchObject({ stopped: [], failed: [{ kind: "child", id: "st_far" }] })
  })

  it("#given no live child #when session_stop fires #then the component reports nothing", async () => {
    const { fake, cancelled } = manager([record({ task_id: "st_done", status: "completed" })])
    const pi = new FakeExtensionAPI()
    registerTaskSessionStop(pi, fake)

    expect(await pi.dispatch("session_stop", { type: "session_stop", requestedBy: "user" }, ctx("session-a"))).toEqual([
      undefined,
    ])
    expect(cancelled).toEqual([])
  })
})
