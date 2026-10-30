import { describe, expect, it } from "bun:test"

import {
  buildCompletionDetails,
  buildTaskSnapshot,
  completionMessageLines,
  createChildProgress,
  type ManagedChildEvent,
  type TaskRecord,
} from "@oh-my-opencode/senpi-task"

import { applyModelEvent } from "../../../../senpi-task/src/manager/runtime-fallback-event"
import { taskOutputModelText } from "../../../../senpi-task/src/tools/output/renderers"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { registerDagCommands, type DagCommandManager } from "./dag-commands"
import { taskRecord } from "./event-bridge.test-fixtures"
import { backgroundWidgetRows, formatTaskRow } from "./status-row-format"
import { taskSnapshot } from "./task-rpc-codec"

// #11359: every surface that labels a delegated task names the model the child is actually on.
// Each row drives the SAME child model events through the record (applyModelEvent, the manager's
// writer) and through the live progress line, then reads every label surface.

const PLANNED = "route-a/model-x"
const FALLBACK = "route-b/model-y"
const SWITCHED = "route-c/model-z"

type Row = {
  readonly name: string
  readonly events: readonly ManagedChildEvent[]
  readonly running: string
  readonly notRunning: readonly string[]
}

const fallbackApplied = {
  type: "retry_fallback_applied",
  from: PLANNED,
  to: FALLBACK,
  chainKey: PLANNED,
  reason: "transient",
} as ManagedChildEvent
const fallbackReverted = {
  type: "retry_fallback_reverted",
  from: FALLBACK,
  to: PLANNED,
} as ManagedChildEvent
const operatorSwitch = {
  type: "model_changed",
  source: "set",
  model: { provider: "route-c", id: "model-z" },
} as ManagedChildEvent

const ROWS: readonly Row[] = [
  { name: "a runtime fallback", events: [fallbackApplied], running: FALLBACK, notRunning: [] },
  {
    name: "a fallback that reverted",
    events: [fallbackApplied, fallbackReverted],
    running: PLANNED,
    notRunning: [FALLBACK],
  },
  { name: "an operator model switch", events: [operatorSwitch], running: SWITCHED, notRunning: [] },
]

function plannedRecord(status: TaskRecord["status"]): TaskRecord {
  return taskRecord({
    task_id: "st_label",
    status,
    model: PLANNED,
    resolved_model: {
      source: "category",
      provider: "route-a",
      model_id: "model-x",
      display: PLANNED,
    },
  })
}

function recordAfter(row: Row, status: TaskRecord["status"]): TaskRecord {
  let record = plannedRecord(status)
  const store = {
    load: () => record,
    replace: (next: TaskRecord) => {
      record = next
    },
  }
  for (const event of row.events) applyModelEvent(store, record.task_id, event)
  return record
}

function liveProgressLine(row: Row): string {
  const record = plannedRecord("running")
  const progress = createChildProgress(
    record.task_id,
    {
      category: record.category,
      agentType: record.agent_type,
      resolvedModel: record.resolved_model,
      model: record.model,
    },
    0,
    () => 0,
  )
  for (const event of row.events) progress.accept(event)
  return progress.details().progress.activity
}

async function dagNodeLine(record: TaskRecord): Promise<string> {
  const pi = new FakeExtensionAPI()
  const manager: DagCommandManager = {
    list: () => [],
    snapshot: () => ({
      runId: "dag_label",
      name: "labels",
      status: "running",
      createdAt: "2026-08-14T00:00:00.000Z",
      nodes: [
        {
          id: "n",
          state: "running",
          route: { kind: "category", category: "deep" },
          dependsOn: [],
          attempt: 1,
          taskId: record.task_id,
        },
      ],
      edges: [],
      waves: [{ nodeIds: ["n"] }],
      criticalPath: [],
      bottlenecks: [],
    }),
    taskRecord: () => record,
  }
  registerDagCommands(pi as never, manager)
  const command = pi.commands.find((entry) => entry.name === "dag")
  const handler = command?.options["handler"] as (args: string, ctx: unknown) => Promise<void>
  const notes: string[] = []
  await handler("dag_label", {
    mode: "tui",
    ui: {
      notify: (message: string) => notes.push(message),
      select: async () => undefined,
      confirm: async () => true,
    },
    sessionManager: { getSessionId: () => "parent-session" },
  })
  return (
    notes
      .join("\n")
      .split("\n")
      .find((line) => line.trim().startsWith("n ")) ?? ""
  )
}

async function surfaces(row: Row): Promise<Record<string, string>> {
  const running = recordAfter(row, "running")
  const finished = recordAfter(row, "completed")
  return {
    "status row and /tasks": formatTaskRow(running),
    "live widget": backgroundWidgetRows([running], new Map(), 0).join("\n"),
    "live progress line": liveProgressLine(row),
    "task_output header": taskOutputModelText(buildTaskSnapshot(finished, "/state", 0)),
    "completion notice": completionMessageLines([buildCompletionDetails(finished)]).join("\n"),
    "omo.task.updated snapshot":
      taskSnapshot(running, undefined, undefined).effective_model?.display ?? "",
    "dag node badge": await dagNodeLine(running),
  }
}

describe("#11359 task model labels after a model change", () => {
  for (const row of ROWS) {
    it(`#given ${row.name} #then every label surface names ${row.running}`, async () => {
      const labels = await surfaces(row)
      const wrong = Object.entries(labels).filter(
        ([, text]) =>
          !text.includes(row.running) || row.notRunning.some((stale) => text.includes(stale)),
      )
      expect(wrong).toEqual([])
    })
  }
})
