import { join } from "node:path"

import { isSpawnSpecV1, type BackgroundMode, type SpawnSpecV1, type TaskRecord, type TaskRecordInput } from "../state"
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
  readonly taskSeq: number
}): TaskRecordInput {
  const { spec, plan, name, executionMode, taskSeq } = input
  const agentType = spec.subagent_type ?? plan.agentType
  const category = spec.category ?? plan.category
  const runInBackground = spec.run_in_background === true
  return {
    name,
    task_seq: taskSeq,
    // The spawn-time mode. A foreground task later handed off with promoteToBackground becomes
    // "promoted", which notify_on_terminal alone cannot distinguish from a background spawn.
    background_mode: runInBackground ? "background" : "foreground",
    parent_session_id: spec.parent_session_id,
    root_session_id: spec.root_session_id ?? spec.parent_session_id,
    depth: spec.depth,
    execution_mode: executionMode,
    model: plan.model,
    notify_on_terminal: runInBackground,
    ...(spec.task_summary !== undefined ? { task_summary: spec.task_summary } : {}),
    ...(spec.description !== undefined ? { description: spec.description } : {}),
    ...(plan.requested_model !== undefined
      ? { requested_model: plan.requested_model }
      : {}),
    ...(plan.fallback_models !== undefined
      ? { fallback_models: plan.fallback_models }
      : {}),
    ...(plan.resolved_model !== undefined ? { resolved_model: plan.resolved_model } : {}),
    ...(agentType !== undefined ? { agent_type: agentType } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(plan.toolAllowlist !== undefined ? { tool_allow: plan.toolAllowlist } : {}),
    ...(plan.toolDenylist !== undefined ? { tool_deny: plan.toolDenylist } : {}),
  }
}

// Background mode after promoteToBackground runs. A task already running in the background keeps
// that mode - nothing was promoted. Legacy records carry no spawn mode, so the durable background
// intent (notify_on_terminal) is the only evidence of how they started.
export function promotedBackgroundMode(record: TaskRecord): BackgroundMode {
  if (record.background_mode !== undefined) {
    return record.background_mode === "foreground" ? "promoted" : record.background_mode
  }
  return record.notify_on_terminal ? "background" : "promoted"
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
    ...(plan.requested_model !== undefined
      ? { requestedModel: plan.requested_model }
      : {}),
    ...(plan.fallback_models !== undefined
      ? { fallbackModels: plan.fallback_models }
      : {}),
    ...(plan.resolved_model !== undefined ? { resolvedModel: plan.resolved_model } : {}),
    ...(plan.variant !== undefined ? { variant: plan.variant } : {}),
    ...(record.agent_type !== undefined ? { agentType: record.agent_type } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(plan.toolAllowlist !== undefined ? { toolAllowlist: plan.toolAllowlist } : {}),
    ...(record.tool_deny !== undefined ? { toolDenylist: record.tool_deny } : {}),
    ...(spec.memberScopedTools !== undefined ? { memberScopedTools: spec.memberScopedTools } : {}),
    ...(spec.memberScopedTools !== undefined
      ? { memberScopedToolNames: spec.memberScopedTools.map((tool) => tool.name) }
      : {}),
    ...(spec.extensions !== undefined ? { extensions: spec.extensions } : {}),
    ...(memberEnv !== undefined ? { memberEnv } : {}),
  }
}

// The v1 spec persisted at spawn for BOTH execution modes: the effective post-planner prompt (never
// the raw pre-planner one), instructions, member-scoped tool NAMES (never executable definitions),
// and cwd. Extensions/member_env are untrusted launch inputs and stay out (rebuilt at respawn).
export function buildSpawnSpecV1(spec: ManagedStartSpec): SpawnSpecV1 {
  return {
    version: 1,
    cwd: spec.cwd,
    prompt: spec.prompt,
    ...(spec.instructions !== undefined ? { instructions: spec.instructions } : {}),
    ...(spec.memberScopedToolNames !== undefined
      ? { member_scoped_tool_names: spec.memberScopedToolNames }
      : {}),
  }
}

export type BuildRespawnManagedSpecResult =
  | { readonly ok: true; readonly spec: ManagedStartSpec }
  | { readonly ok: false; readonly code: "spawn_spec_unavailable"; readonly reason: string }

// Rebuild a ManagedStartSpec from ONLY persisted safe fields (the v1 spawn_spec) plus record facts.
// Runtime-only objects (executable tools, extensions, member env) are never read from the record;
// the respawn path re-resolves them from the live process (todo 12). Legacy/missing specs fail
// closed with a typed spawn_spec_unavailable instead of a silently weakened rebuild.
export function buildRespawnManagedSpec(record: TaskRecord, stateDir: string): BuildRespawnManagedSpecResult {
  const spawnSpec = record.spawn_spec
  if (spawnSpec === undefined || !isSpawnSpecV1(spawnSpec)) {
    return {
      ok: false,
      code: "spawn_spec_unavailable",
      reason: "record has no persisted v1 spawn_spec to rebuild from",
    }
  }
  return {
    ok: true,
    spec: {
      taskId: record.task_id,
      cwd: spawnSpec.cwd,
      stateDir: join(stateDir, "children", record.task_id),
      prompt: spawnSpec.prompt,
      depth: record.depth,
      parentSessionId: record.parent_session_id,
      rootSessionId: record.root_session_id,
      model: record.model,
      ...(record.requested_model !== undefined ? { requestedModel: record.requested_model } : {}),
      ...(record.fallback_models !== undefined ? { fallbackModels: record.fallback_models } : {}),
      ...(record.resolved_model !== undefined ? { resolvedModel: record.resolved_model } : {}),
      // The persisted variant mirror carries the child's thinking level; recover it exactly like the
      // existing rpc respawn path does, or a rebuilt child silently loses its reasoning effort.
      ...(record.resolved_model?.variant === undefined ? {} : { variant: record.resolved_model.variant }),
      ...(record.agent_type !== undefined ? { agentType: record.agent_type } : {}),
      ...(spawnSpec.instructions !== undefined ? { instructions: spawnSpec.instructions } : {}),
      ...(record.tool_allow !== undefined ? { toolAllowlist: record.tool_allow } : {}),
      ...(record.tool_deny !== undefined ? { toolDenylist: record.tool_deny } : {}),
      ...(spawnSpec.member_scoped_tool_names !== undefined
        ? { memberScopedToolNames: spawnSpec.member_scoped_tool_names }
        : {}),
    },
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
