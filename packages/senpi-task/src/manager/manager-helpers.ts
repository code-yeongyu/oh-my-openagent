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
    ...(plan.resolved_model !== undefined ? { resolved_model: plan.resolved_model } : {}),
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
  const memberEnv = spec.memberEnv === undefined
    ? undefined
    : { ...spec.memberEnv, SENPI_TASK_MEMBER_TASK_ID: record.task_id }
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
    ...(spec.extensions !== undefined ? { extensions: spec.extensions } : {}),
    ...(memberEnv !== undefined ? { memberEnv } : {}),
  }
}

export const CONTINUE_SUGGESTION = "Use task_output to read the final result."

export function inSession(record: TaskRecord, sessionId: string): boolean {
  return record.parent_session_id === sessionId || record.root_session_id === sessionId
}

// Fold a spawned child's OS pid onto its record, or return undefined when nothing should change: an
// in-process child (no pid) and an already-terminal record are both left untouched so a settled task
// is never resurrected and an in-process record stays byte-identical.
export function recordSpawnedPid(record: TaskRecord, pid: number | undefined): TaskRecord | undefined {
  if (pid === undefined || isTerminalRecord(record)) return undefined
  return { ...record, pid }
}

export function isTerminalRecord(record: TaskRecord): boolean {
  return (
    record.status === "completed" ||
    record.status === "error" ||
    record.status === "cancelled" ||
    record.status === "interrupted" ||
    record.status === "lost"
  )
}
