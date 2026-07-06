import { join } from "node:path"

import type { TaskRecord, TaskRecordInput } from "../state"
import type { ManagedStartSpec, ManagerStartSpec, ResolvedChildPlan } from "./types"
import type { ExecutionMode } from "./execution-mode"

export function nowIso(now: () => number): string {
  return new Date(now()).toISOString()
}

export function buildRecordInput(input: {
  readonly spec: ManagerStartSpec
  readonly plan: ResolvedChildPlan
  readonly name: string
  readonly executionMode: ExecutionMode
}): TaskRecordInput {
  const { spec, plan, name, executionMode } = input
  const agentType = spec.subagent_type ?? plan.agentType
  const category = spec.category ?? plan.category
  return {
    name,
    parent_session_id: spec.parent_session_id,
    root_session_id: spec.root_session_id ?? spec.parent_session_id,
    depth: spec.depth,
    execution_mode: executionMode,
    model: plan.model,
    ...(agentType !== undefined ? { agent_type: agentType } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(plan.toolAllowlist !== undefined ? { tool_allow: plan.toolAllowlist } : {}),
  }
}

export function buildManagedSpec(input: {
  readonly record: TaskRecord
  readonly spec: ManagerStartSpec
  readonly plan: ResolvedChildPlan
  readonly cwd: string
  readonly stateDir: string
}): ManagedStartSpec {
  const { record, spec, plan, cwd, stateDir } = input
  const prompt = plan.promptAppend ? `${spec.prompt}\n\n${plan.promptAppend}` : spec.prompt
  const instructions = spec.instructions ?? plan.instructions
  return {
    taskId: record.task_id,
    cwd: spec.cwd ?? cwd,
    stateDir: join(stateDir, "children", record.task_id),
    prompt,
    depth: spec.depth,
    parentSessionId: spec.parent_session_id,
    rootSessionId: spec.root_session_id ?? spec.parent_session_id,
    ...(plan.model !== undefined ? { model: plan.model } : {}),
    ...(record.agent_type !== undefined ? { agentType: record.agent_type } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(plan.toolAllowlist !== undefined ? { toolAllowlist: plan.toolAllowlist } : {}),
    ...(spec.memberScopedTools !== undefined ? { memberScopedTools: spec.memberScopedTools } : {}),
  }
}

export function notContinuableReason(record: TaskRecord): string {
  if (record.residency_state === "disposed") return `Task ${record.task_id} was disposed and can no longer be continued.`
  if (record.residency_state === "evicted") return `Task ${record.task_id} was evicted from residency and can no longer be continued.`
  return `Task ${record.task_id} is ${record.status} and can no longer be continued.`
}

export const CONTINUE_SUGGESTION = "Use task_output to read the final result."

export function revivedRecord(record: TaskRecord, timestamp: string): TaskRecord {
  const { final_response: _final, error_message: _error, ...rest } = record
  return {
    ...rest,
    status: "running",
    residency_state: "resident",
    updated_at: timestamp,
    notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 },
  }
}
