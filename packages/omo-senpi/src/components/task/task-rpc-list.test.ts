import { describe, expect, it } from "bun:test"

import { taskRecord } from "./event-bridge.test-fixtures"
import { wireHarness } from "./event-bridge.test-harness"

describe("event-bridge omo.task.list request", () => {
  it("#given an emitted snapshot #when omo.task.list names the active parent session #then it answers the same payload", async () => {
    const running = taskRecord({ task_id: "st_listed", status: "running" })
    const completed = taskRecord({ task_id: "st_done", status: "completed", final_response: "done" })
    const foreign = taskRecord({
      task_id: "st_foreign",
      status: "running",
      parent_session_id: "other-session",
      root_session_id: "other-session",
    })
    const { pi, invokeRpc } = wireHarness("parent-session", {
      records: {
        [running.task_id]: running,
        [completed.task_id]: completed,
        [foreign.task_id]: foreign,
      },
      withRpc: true,
    })
    await pi.dispatch("session_start", {}, {})
    const emitted = pi.rpcEvents.find((entry) => entry.name === "omo.task.updated")

    await expect(
      invokeRpc("omo.task.list", { parent_session_id: "parent-session" }),
    ).resolves.toEqual(emitted?.data)
  })

  it("#given malformed or foreign list requests #when omo.task.list runs #then it fails closed without leaking other sessions", async () => {
    const running = taskRecord({ task_id: "st_list_scope", status: "running" })
    const { pi, invokeRpc } = wireHarness("parent-session", {
      records: { [running.task_id]: running },
      withRpc: true,
    })
    await pi.dispatch("session_start", {}, {})

    await expect(invokeRpc("omo.task.list", null)).resolves.toMatchObject({
      kind: "invalid_arguments",
    })
    await expect(invokeRpc("omo.task.list", {})).resolves.toMatchObject({
      kind: "invalid_arguments",
    })
    await expect(
      invokeRpc("omo.task.list", { parent_session_id: "s".repeat(257) }),
    ).resolves.toMatchObject({ kind: "invalid_arguments" })
    await expect(
      invokeRpc("omo.task.list", { parent_session_id: "other-session" }),
    ).resolves.toEqual({ kind: "not_found", reason: "No such parent session on this connection." })
  })

  it("#given no attached parent session #when omo.task.list runs #then it answers unavailable", async () => {
    const { invokeRpc } = wireHarness(undefined, { withRpc: true })

    await expect(
      invokeRpc("omo.task.list", { parent_session_id: "parent-session" }),
    ).resolves.toMatchObject({ kind: "unavailable" })
  })
})
