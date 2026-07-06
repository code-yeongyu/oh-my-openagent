import { describe, expect, test } from "bun:test"

import type { ListScope, ListedTask } from "../../manager"
import { makeRecord } from "./__fixtures__/records"
import { runTaskList } from "./list"
import type { ListManager } from "./types"

function managerFrom(entries: readonly ListedTask[]): {
  readonly manager: ListManager
  readonly scopes: ListScope[]
} {
  const scopes: ListScope[] = []
  const manager: ListManager = {
    list(scope) {
      scopes.push(scope)
      if (scope.scope === "all") return entries
      return entries.filter((entry) => entry.record.parent_session_id === scope.session_id)
    },
  }
  return { manager, scopes }
}

const NOW = Date.parse("2024-12-03T15:00:00.000Z")

describe("runTaskList", () => {
  test("#given tasks across sessions #when scoped to caller #then only the caller's children are listed", () => {
    // given
    const entries: ListedTask[] = [
      { record: makeRecord({ task_id: "st_a", parent_session_id: "session-parent", name: "alpha" }) },
      { record: makeRecord({ task_id: "st_b", parent_session_id: "session-other", name: "beta" }) },
    ]
    const { manager } = managerFrom(entries)

    // when
    const result = runTaskList(manager, {}, "session-parent", () => NOW)

    // then
    expect(result.details.scope).toBe("parent-session")
    expect(result.details.tasks.map((task) => task.task_id)).toEqual(["st_a"])
  })

  test("#given all_scope #when listed #then every persisted task is returned regardless of session", () => {
    // given
    const entries: ListedTask[] = [
      { record: makeRecord({ task_id: "st_a", parent_session_id: "session-parent" }) },
      { record: makeRecord({ task_id: "st_b", parent_session_id: "session-other" }) },
    ]
    const { manager, scopes } = managerFrom(entries)

    // when
    const result = runTaskList(manager, { all_scope: true }, "session-parent", () => NOW)

    // then
    expect(result.details.scope).toBe("all")
    expect(scopes.at(-1)).toEqual({ scope: "all" })
    expect(result.details.tasks.length).toBe(2)
  })

  test("#given no caller session and no all_scope #when listed #then it fails closed with an empty list", () => {
    // given
    const entries: ListedTask[] = [{ record: makeRecord({ task_id: "st_a", parent_session_id: "session-parent" }) }]
    const { manager, scopes } = managerFrom(entries)

    // when
    const result = runTaskList(manager, {}, undefined, () => NOW)

    // then
    expect(result.details.tasks).toEqual([])
    expect(scopes.length).toBe(0)
  })

  test("#given include_terminal false #when listed #then terminal tasks are excluded", () => {
    // given
    const entries: ListedTask[] = [
      { record: makeRecord({ task_id: "st_run", status: "running" }) },
      { record: makeRecord({ task_id: "st_done", status: "completed" }) },
    ]
    const { manager } = managerFrom(entries)

    // when
    const result = runTaskList(manager, { include_terminal: false }, "session-parent", () => NOW)

    // then
    expect(result.details.tasks.map((task) => task.task_id)).toEqual(["st_run"])
  })

  test("#given mixed statuses #when listed #then running sorts before pending before terminal, recent first", () => {
    // given
    const entries: ListedTask[] = [
      { record: makeRecord({ task_id: "st_done_old", status: "completed", updated_at: "2024-12-03T14:00:00.000Z" }) },
      { record: makeRecord({ task_id: "st_pending", status: "pending", updated_at: "2024-12-03T14:10:00.000Z" }), queue_position: 2 },
      { record: makeRecord({ task_id: "st_run_old", status: "running", updated_at: "2024-12-03T14:05:00.000Z" }) },
      { record: makeRecord({ task_id: "st_run_new", status: "running", updated_at: "2024-12-03T14:30:00.000Z" }) },
      { record: makeRecord({ task_id: "st_done_new", status: "completed", updated_at: "2024-12-03T14:20:00.000Z" }) },
    ]
    const { manager } = managerFrom(entries)

    // when
    const result = runTaskList(manager, {}, "session-parent", () => NOW)

    // then
    expect(result.details.tasks.map((task) => task.task_id)).toEqual([
      "st_run_new",
      "st_run_old",
      "st_pending",
      "st_done_new",
      "st_done_old",
    ])
  })

  test("#given a completed background task not yet notified #when listed #then the unread flag is set and queue_position carried for pending", () => {
    // given
    const entries: ListedTask[] = [
      { record: makeRecord({ task_id: "st_unread", status: "completed", run_epoch: 0, notified_epoch: -1 }) },
      { record: makeRecord({ task_id: "st_read", status: "completed", run_epoch: 0, notified_epoch: 0 }) },
      { record: makeRecord({ task_id: "st_pending", status: "pending" }), queue_position: 4 },
    ]
    const { manager } = managerFrom(entries)

    // when
    const result = runTaskList(manager, {}, "session-parent", () => NOW)

    // then
    const byId = new Map(result.details.tasks.map((task) => [task.task_id, task]))
    expect(byId.get("st_unread")?.unread_notification).toBe(true)
    expect(byId.get("st_read")?.unread_notification).toBe(false)
    expect(byId.get("st_pending")?.queue_position).toBe(4)
    expect(byId.get("st_pending")?.age_ms).toBeGreaterThan(0)
  })
})
