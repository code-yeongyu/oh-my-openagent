// #15150: a workflow node whose child waits for its revival must not read as busy in the widget.
import { describe, expect, test } from "bun:test"

import { AWAITING_REVIVAL_ACTIVITY } from "./dag-quiet-nodes"
import { createDagStatusUi, type DagStatusUiRunSnapshot } from "./dag-status-ui"
import type { CapturedUi } from "./runtime-context"

function widgetRows(residency_state: string): readonly string[] {
  const painted: string[][] = []
  const ui: CapturedUi = {
    notify: () => undefined,
    setStatus: () => undefined,
    setWidget: (_key, content) => {
      if (content !== undefined) painted.push([...content])
    },
    select: () => Promise.resolve(undefined),
    confirm: () => Promise.resolve(false),
  }
  const run: DagStatusUiRunSnapshot = {
    runId: "run-1",
    name: "pending revival",
    status: "running",
    waves: [{ index: 0, nodeIds: ["k-hang"] }],
    nodes: [
      { id: "k-hang", state: "running", route: { kind: "category", category: "quick" }, dependsOn: [], taskId: "st_1" },
    ],
  }
  const statusUi = createDagStatusUi({
    manager: { list: () => [{ runId: "run-1", status: "running" }], snapshot: () => run },
    runtime: { ui: () => ui, sessionId: () => "parent-1", mode: () => "tui" },
    timers: { set: () => 0, clear: () => undefined },
    terminalWidth: () => 160,
    childRecord: () => ({ status: "running", residency_state }),
  })
  statusUi.syncNow()
  statusUi.dispose()
  return painted.at(-1) ?? []
}

describe("dag widget row for a node waiting on its child's revival (#15150)", () => {
  test("#given the node's unfinished child is suspended #when the widget paints #then the row says it waits for the revival", () => {
    expect(widgetRows("rpc_detached").join("\n")).toContain(AWAITING_REVIVAL_ACTIVITY)
  })

  test("#given the node's child is live here #when the widget paints #then the row carries no revival wording", () => {
    expect(widgetRows("resident").join("\n")).not.toContain(AWAITING_REVIVAL_ACTIVITY)
  })
})
