import { afterEach, describe, expect, spyOn, test } from "bun:test"

import { wireHarness } from "./event-bridge.test-harness"
import { taskRecord } from "./event-bridge.test-fixtures"

afterEach(() => { stderr?.mockRestore() })
let stderr: ReturnType<typeof spyOn<typeof process.stderr, "write">> | undefined

function children() {
  return Object.fromEntries(["st_000000a1", "st_000000a2"].map((task_id) => [
    task_id, taskRecord({ task_id, status: "running", execution_mode: "process", runner_kind: "host-session" }),
  ]))
}

describe("shutdown background notice", () => {
  test("#given two running daemon children #when new_session shuts down the old parent #then one TUI notice names the old durable session and resume action", async () => {
    const { pi } = wireHarness("parent-session", { records: children() })
    const notices: string[] = []
    await pi.dispatch("session_shutdown", { reason: "new" }, {
      hasUI: true, mode: "interactive", ui: { notify: (message: string) => notices.push(message) },
    })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("2 background task(s)")
    expect(notices[0]).toContain("session parent-session")
    expect(notices[0]).toContain("omo --resume parent-session")
    expect(notices[0]).toContain("collect their results")
  })

  for (const mode of ["print", "json"]) {
    test(`#given two daemon children in ${mode} mode #when the parent exits #then the trailer appears exactly once without corrupting stdout`, async () => {
      stderr = spyOn(process.stderr, "write").mockImplementation(() => true)
      const { pi } = wireHarness("parent-session", { records: children() })
      await pi.dispatch("session_shutdown", { reason: "quit" }, { mode, hasUI: false })
      expect(stderr).toHaveBeenCalledTimes(1)
      expect(stderr.mock.calls[0]?.[0]).toContain("2 background task(s)")
      expect(stderr.mock.calls[0]?.[0]).toContain("omo --resume parent-session")
    })
  }

  test("#given a pending process child and terminal, foreign and local children #when new_session commits #then only the pending daemon work is counted", async () => {
    const pending = taskRecord({ task_id: "st_000000a3", status: "pending", execution_mode: "process" })
    const records = {
      pending,
      done: taskRecord({ task_id: "st_000000a4", status: "completed", runner_kind: "host-session" }),
      foreign: taskRecord({ task_id: "st_000000a5", status: "running", runner_kind: "host-session", parent_session_id: "other" }),
      local: taskRecord({ task_id: "st_000000a6", status: "running" }),
    }
    const { pi } = wireHarness("parent-session", { records })
    const notices: string[] = []
    await pi.dispatch("session_shutdown", { reason: "new" }, {
      hasUI: true, ui: { notify: (message: string) => notices.push(message) },
    })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain("1 background task(s)")
  })

  for (const reason of ["new", "quit", "reload"]) {
    test(`#given no daemon children #when shutdown reason is ${reason} #then no notice is rendered`, async () => {
      stderr = spyOn(process.stderr, "write").mockImplementation(() => true)
      const { pi } = wireHarness("parent-session")
      const notices: string[] = []
      await pi.dispatch("session_shutdown", { reason }, {
        mode: "print", hasUI: true, ui: { notify: (message: string) => notices.push(message) },
      })
      expect(notices).toEqual([])
      expect(stderr).not.toHaveBeenCalled()
    })
  }
})
