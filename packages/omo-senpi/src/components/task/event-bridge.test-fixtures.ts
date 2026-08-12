import type { SuspendSummary, TaskRecord } from "@oh-my-opencode/senpi-task"

export const fakeSummary: SuspendSummary = {
  suspended_in_process: 0,
  suspended_rpc: 0,
  suspended_pending: 0,
  disposed: 0,
  failures: [],
}

export function taskRecord(
  overrides: Partial<TaskRecord> & { task_id: string; status: TaskRecord["status"] },
): TaskRecord {
  return {
    name: "worker",
    task_summary: "Inspect native task events",
    description: "Prove task lifecycle snapshots reach RPC clients",
    parent_session_id: "parent-session",
    root_session_id: "parent-session",
    depth: 1,
    agent_type: "explore",
    category: "deep",
    execution_mode: "in-process",
    model: "mock/worker",
    residency_state: "resident",
    created_at: "2026-08-11T00:00:00.000Z",
    updated_at: "2026-08-11T00:00:01.000Z",
    notification: { run_epoch: 0, notified_epoch: -1 },
    notify_on_terminal: true,
    ...overrides,
  }
}

export function taskSnapshot(record: TaskRecord) {
  return {
    task_id: record.task_id,
    name: record.name,
    task_summary: record.task_summary,
    description: record.description,
    agent_type: record.agent_type,
    category: record.category,
    model: record.model,
    status: record.status,
    residency_state: record.residency_state,
    execution_mode: record.execution_mode,
    depth: record.depth,
    created_at: record.created_at,
    updated_at: record.updated_at,
    ...(record.run_stats === undefined ? {} : { run_stats: record.run_stats }),
  }
}
