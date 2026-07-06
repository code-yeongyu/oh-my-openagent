import type { ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"
import type { Static } from "typebox"

import type { ListScope, ListedTask } from "../../manager"
import type { TaskRecord } from "../../state"
import { defaultResolveCallerSessionId, toolResult } from "../control"
import { renderTranscript } from "./render"
import { buildTaskSnapshot } from "./snapshot"
import { defaultTranscriptReader } from "./transcript"
import type { TaskOutputDeps, TaskOutputDetails, TaskOutputToolResult, TaskSnapshot, TranscriptReader } from "./types"

export const TaskOutputParams = Type.Object({
  task_id: Type.Optional(Type.String({ description: "Task id (st_...) of the child to read." })),
  name: Type.Optional(Type.String({ description: "Canonical task name, as an alternative to task_id." })),
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

const DESCRIPTION = [
  "Read one child task, keyed by task_id or name. mode='status' (default) returns the record snapshot plus the final response once terminal.",
  "mode='tail' returns the last tail_lines of the recorded transcript; mode='full' returns the whole transcript (capped, with a head/tail elision marker).",
  "READ-ONLY: this never revives, steers, or otherwise touches the child. A lost task returns a status view with a lost explanation and pid/session-dir breadcrumbs.",
  "Only the current session's children are visible.",
].join(" ")

export function runTaskOutput(
  deps: TaskOutputDeps,
  params: TaskOutputInput,
  callerSessionId: string | undefined,
): TaskOutputToolResult {
  const idOrName = params.task_id ?? params.name
  if (idOrName === undefined) return invalidArguments("Provide task_id or name to identify the child task.")

  const candidates = scopedCandidates(deps.manager.list.bind(deps.manager), callerSessionId)
  const record = resolveTarget(candidates, idOrName)
  if (record === undefined) return notFound(candidates, idOrName)

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
  const { entries, source } = reader({ taskId: record.task_id, stateDir: deps.stateDir })
  const rendered = renderTranscript(entries, { mode, tailLines })
  const details: TaskOutputDetails = {
    kind: "transcript",
    mode,
    source,
    transcript: rendered.text,
    truncated: rendered.truncated,
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
  const parts = [`${snapshot.task_id} [${snapshot.status}] model ${snapshot.model}`]
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

export function createTaskOutputTool(deps: TaskOutputDeps): ToolDefinition<typeof TaskOutputParams, TaskOutputDetails> {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  return {
    name: "task_output",
    label: "Task Output",
    description: DESCRIPTION,
    parameters: TaskOutputParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx) => Promise.resolve(runTaskOutput(deps, params, resolveCaller(ctx))),
  }
}
