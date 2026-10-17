import { expect, test } from "bun:test"
import { createTaskRecord, recoveryPresentation, type TaskRecord } from "@oh-my-opencode/senpi-task"
import { buildTaskSnapshot } from "../../../../senpi-task/src/tools/output/snapshot"
import { renderTaskOutputResult } from "../../../../senpi-task/src/tools/output/renderers"
import { panelChildFromRecord } from "../side-panel/data/task-records"
import { buildAgentCardRows, buildAgentRows } from "../side-panel/sections/agents"
import type { PanelChild } from "../side-panel/store"
import { backgroundWidgetRows, buildWidgetRows, formatTaskRow, isSuspended } from "./status-row-format"

const shapes: readonly [string, Partial<TaskRecord>, "resuming" | "ending"][] = [
  ["parent restart", { residency_state: "persisted_only" }, "resuming"],
  ["host drain", { residency_state: "rpc_detached", suspension_reason: "host_draining" }, "resuming"],
  ["daemon loss", { residency_state: "rpc_detached", suspension_reason: "daemon_unavailable" }, "resuming"],
  ["incompatible host", { residency_state: "rpc_detached", suspension_reason: "host_incompatible" }, "ending"],
  ["missing transcript", { residency_state: "persisted_only", revival_deferred_reason: "transcript_unavailable" }, "ending"],
  ["deadline teardown", { residency_state: "resident", failure_kind: "suspended_unresumable" }, "ending"],
]

for (const [name, overrides, expected] of shapes) {
  test(`${name} has consistent automatic recovery wording on every surface`, () => {
    const record: TaskRecord = {
      ...createTaskRecord({
        parent_session_id: "parent", root_session_id: "parent", depth: 1,
        execution_mode: "process", model: "provider/model", notify_on_terminal: true,
      }),
      status: "running", name: "child", ...overrides,
    }
    const presentation = recoveryPresentation(record)
    expect(presentation?.state).toBe(expected)
    const snapshot = buildTaskSnapshot(record, "/tmp/task-recovery-surface", Date.now())
    expect(snapshot.suspended?.explanation).toBe(presentation?.text)
    const output = renderTaskOutputResult(
      { content: [], details: { kind: "status", snapshot } },
      { expanded: false, isPartial: false },
      { fg: (_color, text) => text },
    ).render(220)
    const update = panelChildFromRecord(record)
    expect(update.status).toBe(expected)
    const child: PanelChild = {
      id: record.task_id, name: "child", status: update.status ?? "queued",
      startedAt: 0, parkedReason: update.parkedReason,
    }
    const card = buildAgentCardRows(child, 100)
    expect(card[0]?.color).toBe("muted")
    for (const text of [
      ...output, formatTaskRow(record), ...buildWidgetRows([record]),
      ...backgroundWidgetRows([record], new Map(), 0, undefined, 220),
      card[0]?.text ?? "",
    ]) {
      expect(text).toContain(expected)
      expect(text).not.toMatch(/suspended|\/task-kill|next message|resumes with session/u)
    }
    expect(buildAgentRows([child], 100, 80).some((row) => row.color === "warning")).toBe(false)
  })
}

for (const [status, panelStatus] of [
  ["completed", "finished"], ["error", "failed"], ["cancelled", "cancelled"],
  ["interrupted", "cancelled"], ["lost", "failed"],
] as const) {
  for (const residency_state of ["disposed", "evicted", "persisted_only", "rpc_detached"] as const) {
    test(`${status} with ${residency_state} stays terminal on every recovery surface`, () => {
      const record: TaskRecord = {
        ...createTaskRecord({
          parent_session_id: "parent", root_session_id: "parent", depth: 1,
          execution_mode: "process", model: "provider/model", notify_on_terminal: true,
        }),
        status, residency_state, name: "child",
      }
      expect(recoveryPresentation(record)).toBeUndefined()
      expect(isSuspended(record)).toBe(false)
      const snapshot = buildTaskSnapshot(record, "/tmp/task-recovery-surface", 0)
      expect(snapshot.suspended).toBeUndefined()
      expect(snapshot.status).toBe(status)
      const output = renderTaskOutputResult(
        { content: [], details: { kind: "status", snapshot } },
        { expanded: false, isPartial: false },
        { fg: (_color, text) => text },
      ).render(220)
      expect(output.join("\n")).toContain(status)
      expect(formatTaskRow(record)).toContain(`status:${status}`)
      expect(buildWidgetRows([record])).toEqual([])
      expect(backgroundWidgetRows([record], new Map(), 0, undefined, 220)).toEqual([])
      const update = panelChildFromRecord(record)
      expect(update.status).toBe(panelStatus)
      expect(update.parkedReason).toBeUndefined()
      const child: PanelChild = { id: record.task_id, name: "child", status: panelStatus, startedAt: 0 }
      expect(buildAgentCardRows(child, 100)[0]?.text).toContain(panelStatus)
    })
  }
}
