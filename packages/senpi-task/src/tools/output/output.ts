import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import type { ListScope, ListedTask } from "../../manager"
import type { TaskRecord } from "../../state"
import { defaultResolveCallerSessionId, toolResult } from "../control"
import { renderTaskOutputCall, renderTaskOutputResult, taskOutputModelText } from "./renderers"
import { renderTranscript } from "./render"
import { buildTaskSnapshot } from "./snapshot"
import { defaultTranscriptReader } from "./transcript"
import type { TaskOutputDeps, TaskOutputDetails, TaskOutputToolResult, TaskSnapshot, TranscriptReader } from "./types"

export const TaskOutputParams = Type.Object({
  task_id: Type.Optional(Type.String({ description: "Task id (st_...) of the child to read. Provide exactly one of task_id or name." })),
  name: Type.Optional(Type.String({ description: "Canonical task name; required if task_id is omitted." })),
  mode: Type.Optional(
    Type.Union([Type.Literal("status"), Type.Literal("tail"), Type.Literal("full")], {
      description: "status (default) = record snapshot + final result; tail = last lines of the transcript; full = whole transcript.",
    }),
  ),
  tail_lines: Type.Optional(
    Type.Integer({ minimum: 1, description: "Lines to keep in tail mode. Defaults to 60." }),
  ),
})

export type TaskOutputInput = Static<typeof TaskOutputParams>

const DEFAULT_TAIL_LINES = 60
const MAX_STATUS_READS = 1024
const BLOCKING_REMOVED_GUIDANCE = 'blocking removed - completion arrives as a notification; use mode:"tail" to peek.'

const DESCRIPTION = [
  "Read one child task, keyed by task_id or name. task_output always returns immediately: mode='status' (default) returns one record snapshot per observed progress state, then a short no_progress result until the task changes.",
  "mode='tail' returns the last tail_lines of the recorded transcript; mode='full' returns the whole transcript (capped, with a head/tail elision marker). These explicit transcript modes do not consume the status peek. Completion notifications already include the final result.",
  "READ-ONLY: this never revives, steers, or otherwise touches the child. A lost task returns a status view with a lost explanation and pid/session-dir breadcrumbs.",
  "Only the current session's children are visible.",
].join(" ")

export function runTaskOutput(
  deps: TaskOutputDeps,
  params: TaskOutputInput,
  callerSessionId: string | undefined,
  statusReads?: Map<string, string>,
): Promise<TaskOutputToolResult> {
  if (hasLegacyBlockingParam(params)) return Promise.resolve(invalidArguments(BLOCKING_REMOVED_GUIDANCE))

  const idOrName = params.task_id ?? params.name
  if (idOrName === undefined) return Promise.resolve(invalidArguments("Provide task_id or name to identify the child task."))

  const candidates = scopedCandidates(deps.manager.list.bind(deps.manager), callerSessionId)
  const record = resolveTarget(candidates, idOrName)
  if (record === undefined) return Promise.resolve(notFound(candidates, idOrName))

  const mode = params.mode ?? "status"
  if (statusReads !== undefined && callerSessionId !== undefined && (mode === "status" || record.status === "lost")) {
    const key = JSON.stringify([callerSessionId, record.task_id])
    const fingerprint = JSON.stringify([
      record.status,
      record.residency_state,
      record.updated_at,
      record.notification.run_epoch,
      record.pid ?? null,
      record.host_pid ?? null,
      record.child_session_id ?? null,
      record.final_response ?? null,
      record.error_message ?? null,
      record.killed ?? null,
      record.run_stats ?? null,
    ])
    if (statusReads.get(key) === fingerprint) return Promise.resolve(noProgress(record))
    rememberStatusRead(statusReads, key, fingerprint)
  }

  return Promise.resolve(outputForRecord(deps, record, params))
}

function rememberStatusRead(statusReads: Map<string, string>, key: string, fingerprint: string): void {
  statusReads.delete(key)
  statusReads.set(key, fingerprint)
  if (statusReads.size <= MAX_STATUS_READS) return

  const oldestKey = statusReads.keys().next().value
  if (oldestKey !== undefined) statusReads.delete(oldestKey)
}

function hasLegacyBlockingParam(params: object): boolean {
  return Reflect.get(params, "block") !== undefined || Reflect.get(params, "timeout_ms") !== undefined
}

function outputForRecord(deps: TaskOutputDeps, record: TaskRecord, params: TaskOutputInput): TaskOutputToolResult {
  const now = (deps.now ?? Date.now)()
  const snapshot = buildTaskSnapshot(record, deps.stateDir, now)
  const mode = params.mode ?? "status"

  if (mode === "status" || record.status === "lost") {
    return toolResult(statusText(snapshot), { kind: "status", snapshot })
  }

  return transcriptResult(deps, record, snapshot, mode, params.tail_lines ?? DEFAULT_TAIL_LINES)
}

function transcriptResult(
  deps: TaskOutputDeps,
  record: TaskRecord,
  snapshot: TaskSnapshot,
  mode: "tail" | "full",
  tailLines: number,
): TaskOutputToolResult {
  const reader: TranscriptReader = deps.transcriptReader ?? defaultTranscriptReader
  const { entries, source, truncated: sourceTruncated } = reader({
    taskId: record.task_id,
    stateDir: deps.stateDir,
  })
  const rendered = renderTranscript(entries, { mode, tailLines })
  const details: TaskOutputDetails = {
    kind: "transcript",
    mode,
    source,
    transcript: rendered.text,
    truncated: rendered.truncated || sourceTruncated === true,
    snapshot,
  }
  return toolResult(`${record.task_id} [${record.status}] transcript via ${source}:\n${rendered.text}`, details)
}

// Fail-closed scope: candidates are ONLY the caller session's children. No caller id -> nothing is
// visible, so a valid id owned by another session reads as not_found (never cross-session leakage).
function scopedCandidates(
  list: (scope: ListScope) => readonly ListedTask[],
  callerSessionId: string | undefined,
): readonly TaskRecord[] {
  if (callerSessionId === undefined) return []
  return list({ scope: "parent-session", session_id: callerSessionId }).map((entry) => entry.record)
}

function resolveTarget(candidates: readonly TaskRecord[], idOrName: string): TaskRecord | undefined {
  return candidates.find((record) => record.task_id === idOrName) ?? candidates.find((record) => record.name === idOrName)
}

function statusText(snapshot: TaskSnapshot): string {
  const parts = [`${snapshot.task_id} [${snapshot.status}] ${taskOutputModelText(snapshot)}`]
  if (snapshot.suspended !== undefined) parts.push(snapshot.suspended.explanation)
  if (snapshot.pid !== undefined) parts.push(`pid ${snapshot.pid}`)
  if (snapshot.lost !== undefined) parts.push(snapshot.lost.explanation)
  if (snapshot.error_message !== undefined) parts.push(`error: ${snapshot.error_message}`)
  if (snapshot.final_response !== undefined) parts.push(snapshot.final_response)
  return parts.join("\n")
}

function notFound(candidates: readonly TaskRecord[], idOrName: string): TaskOutputToolResult {
  const known = candidates.map((record) => record.name ?? record.task_id)
  const listText = known.length > 0 ? ` Known tasks in this session: ${known.join(", ")}.` : ""
  return toolResult(`No task '${idOrName}' in this session.${listText}`, { kind: "not_found", reason: `No task '${idOrName}' in this session.`, known_tasks: known })
}

function invalidArguments(reason: string): TaskOutputToolResult {
  return toolResult(reason, { kind: "invalid_arguments", reason })
}

function noProgress(record: TaskRecord): TaskOutputToolResult {
  const reason = `Task ${record.task_id} has not changed since the last status read. Await its completion notification; use mode:"tail" only for explicit transcript diagnosis.`
  return toolResult(reason, {
    kind: "no_progress",
    task_id: record.task_id,
    status: record.status,
    reason,
  })
}

export function createTaskOutputTool(deps: TaskOutputDeps): ToolDefinition<typeof TaskOutputParams, TaskOutputDetails> {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  const statusReads = new Map<string, string>()
  return {
    name: "task_output",
    label: "Task Output",
    description: DESCRIPTION,
    parameters: TaskOutputParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) =>
      runTaskOutput(deps, params, resolveCaller(ctx), statusReads),
    renderCall: (args, theme) => renderTaskOutputCall(args, theme),
    renderResult: (result, options, theme) => renderTaskOutputResult(result, options, theme),
  }
}
