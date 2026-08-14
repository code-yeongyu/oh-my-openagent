import type { ManagedChildEvent, TaskRecord } from "@oh-my-opencode/senpi-task"

import type { HerdrReportedTask } from "./herdr-command-client"

export function taskTitle(record: TaskRecord): string {
  return record.name ?? record.task_id
}

export function taskAgentType(record: TaskRecord): string {
  return record.agent_type ?? record.category ?? "subagent"
}

export function taskSignature(record: TaskRecord): string {
  return [
    record.status,
    record.child_session_id ?? "",
    taskTitle(record),
    taskAgentType(record),
  ].join("\u0000")
}

export function taskReport(
  record: TaskRecord,
  paneId: string,
  sequence: number,
): HerdrReportedTask {
  const terminal = record.status !== "running"
  return {
    paneId,
    taskId: record.task_id,
    agentType: taskAgentType(record),
    title: taskTitle(record),
    state: terminal ? "idle" : "working",
    stateLabel: record.status,
    message: record.status,
    ...(record.child_session_id === undefined ? {} : { sessionId: record.child_session_id }),
    sequence,
  }
}

export function childEventLine(
  event: ManagedChildEvent,
  includeAssistantOutput: boolean,
): string | undefined {
  if (event.type === "tool_execution_start") return `[tool] ${event.toolName ?? "tool"} started`
  if (event.type === "tool_execution_end") {
    return `[tool] ${event.toolName ?? "tool"} ${event.isError === true ? "failed" : "finished"}`
  }
  if (includeAssistantOutput && event.type === "message_end") {
    const text = assistantMessageText(event.message)
    if (text !== undefined) return `[message] ${text}`
  }
  return undefined
}

function assistantMessageText(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) return undefined
  const text = message.content
    .filter(isTextPart)
    .map((part) => part.text)
    .join("")
  return text.length > 0 ? text : undefined
}

function isTextPart(value: unknown): value is { readonly type: "text"; readonly text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
