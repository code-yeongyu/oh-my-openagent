// The one decision about a turn a settled DAG child starts on its own (#11381, #12134): the manager's
// fence and the scheduler that follows the turn both ask selfResumeVerdict. One row per boundary case.
import { describe, expect, test } from "bun:test"

import type { TaskRecord } from "../state"
import type { DagRunRecordV1 } from "./manager"
import { selfResumeVerdict } from "./owner-resume-fence"
import { node, recordFor, runId } from "./scheduler-self-resume.test-harness"
import type { DagNodeId, DagRunStatus } from "./types"

function run(status: DagRunStatus, pause?: DagRunRecordV1["pause"]): DagRunRecordV1 {
  const record = recordFor([node("A"), node("B")])
  return {
    ...record,
    status,
    ...(pause === undefined ? {} : { pause }),
    nodes: record.nodes.map((entry) => (entry.id === "A" ? { ...entry, execAttempt: 1 } : entry)),
  }
}

function claim(nodeId: string, execAttempt: number): TaskRecord {
  return {
    task_id: `task-${nodeId}-${execAttempt}`,
    parent_session_id: "ses-parent",
    root_session_id: "ses-root",
    depth: 1,
    category: "quick",
    execution_mode: "in-process",
    model: "fake-model",
    notify_on_terminal: true,
    owner: { kind: "dag", runId, nodeId: nodeId as DagNodeId, fingerprint: `fp-${nodeId}`, execAttempt },
    status: "completed",
    residency_state: "resident",
    created_at: "2026-11-26T00:00:00.000Z",
    updated_at: "2026-11-26T00:00:00.000Z",
    notification: { run_epoch: 1, notified_epoch: 1 },
  }
}

const current = claim("A", 1)
const superseded = claim("A", 0)
const removed = claim("gone", 0)
const userStop = { reason: "user_stop", pauseSeq: 3 } as const

describe("selfResumeVerdict boundary table (#12134 on #11381)", () => {
  test.each([
    ["running", run("running"), false, current, "allow"],
    ["running, cancelling", run("running"), true, current, "refuse:retire"],
    ["paused by shutdown", run("paused"), false, current, "allow"],
    ["paused by the user", run("paused", userStop), false, current, "refuse:hold"],
    ["failed", run("failed"), false, current, "refuse:hold"],
    ["completed", run("completed"), false, current, "refuse:hold"],
    ["cancelled", run("cancelled"), false, current, "refuse:retire"],
    ["running, superseded attempt", run("running"), false, superseded, "refuse:retire"],
    ["failed, superseded attempt", run("failed"), false, superseded, "refuse:retire"],
    ["running, removed node", run("running"), false, removed, "refuse:retire"],
  ] as const)("#given %s #then the verdict is the single answer", (_case, record, cancelling, task, expected) => {
    const verdict = selfResumeVerdict(task, record, cancelling)
    expect(verdict.kind === "allow" ? "allow" : `refuse:${verdict.disposition}`).toBe(expected)
  })

  test("#given a turn the user stop holds #when the caller can record it #then only that row carries the record effect, which the caller supplied", () => {
    const recordHeld = (): void => undefined
    const held = selfResumeVerdict(current, run("paused", userStop), false, recordHeld)
    const failed = selfResumeVerdict(current, run("failed"), false, recordHeld)
    const shutdown = selfResumeVerdict(current, run("paused"), false, recordHeld)

    expect(held.kind === "refuse" ? held.record : undefined).toBe(recordHeld)
    expect(failed.kind === "refuse" ? failed.record : "allow").toBeUndefined()
    expect(shutdown.kind).toBe("allow")
  })
})
