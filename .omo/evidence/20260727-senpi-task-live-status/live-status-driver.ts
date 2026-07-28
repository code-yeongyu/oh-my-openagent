import type { ListedTask, TaskRecord, TaskRunStats } from "@oh-my-opencode/senpi-task"

import type { CapturedUi } from "../../../packages/omo-senpi/src/components/task/runtime-context"
import {
  createTaskStatusUi,
  type StatusUiManager,
} from "../../../packages/omo-senpi/src/components/task/status-ui"

const startedAt = Date.now()
let task: TaskRecord = {
  task_id: "st_live_qa",
  parent_session_id: "session-qa",
  root_session_id: "session-qa",
  depth: 0,
  execution_mode: "in-process",
  model: "openai/gpt-5.6-sol",
  category: "ultrabrain",
  description: "Drag/poi...",
  status: "running",
  residency_state: "resident",
  run_in_background: true,
  created_at: new Date(startedAt).toISOString(),
  updated_at: new Date(startedAt).toISOString(),
  notification: { run_epoch: 0, notified_epoch: -1 },
}

function stats(): TaskRunStats {
  const elapsed = Date.now() - startedAt
  return {
    runtime_ms: elapsed,
    turns: 81,
    tool_calls: 210 + Math.floor(elapsed / 1_000),
    tokens_per_second: 40 + Math.floor(elapsed / 1_000),
  }
}

const manager: StatusUiManager = {
  list: (): readonly ListedTask[] => [{ record: task }],
  wasBackground: () => true,
  subscribeChild: () => () => undefined,
  runStatsSnapshot: stats,
}

const ui: CapturedUi = {
  setStatus: () => undefined,
  setWidget: (_key, content) => {
    const row = content?.[0]
    if (row === undefined) return
    process.stdout.write(`\r\u001B[2K${row}`)
  },
}

const statusUi = createTaskStatusUi({
  manager,
  runtime: {
    ui: () => ui,
    sessionId: () => "session-qa",
    mode: () => "tui",
  },
})

statusUi.syncNow()
setTimeout(() => {
  task = { ...task, status: "completed", updated_at: new Date().toISOString() }
  statusUi.syncNow()
  statusUi.dispose()
  process.stdout.write("\nPASS live status advanced while parent input stayed idle\n")
}, 2_600)
