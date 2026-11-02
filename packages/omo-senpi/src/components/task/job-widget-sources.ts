import { formatToolActivity, type ManagedChildEvent, type TaskRecord } from "@oh-my-opencode/senpi-task"

import { redactSensitiveOutput } from "../memory/kibitzer/sensitive-output"
import type { JobWidgetBriefText, JobWidgetSourceHandle, JobWidgetSourcesApi, JobWidgetTextTap } from "./job-widget-host"
import { isTerminal } from "./status-row-format"
import type { StoreMutation } from "./store-mutation-observer"

// senpi's `TOOLS_SOURCE_ID` / `TOOL_CALL_MARK` (job-widgets/source-types.ts): the source a task job's
// subagent tool calls arrive on, each opened by the engine's marker line `» <tool> <intent>`.
export const TASK_TOOLS_SOURCE_ID = "tools"
export const TASK_TOOL_CALL_MARK = "» "
const TASK_TOOLS_SOURCE_LABEL = `subagent tool calls: \`${TASK_TOOL_CALL_MARK}<tool> <intent>\` (omo's marker) then the result text`
const MAX_TOOL_RESULT_CHARS = 64 * 1024
const MAX_ASSIGNMENT_CHARS = 4 * 1024
const MAX_WATCH_COMMAND_CHARS = 300

export interface TaskJobWidgetManager {
  subscribeChild(taskId: string, listener: (event: ManagedChildEvent) => void): () => void
  list(scope: { readonly scope: "parent-session"; readonly session_id: string }): readonly { readonly record: TaskRecord }[]
}

export interface TaskJobWidgetFeedDeps {
  readonly sources: JobWidgetSourcesApi
  readonly manager: TaskJobWidgetManager
  readonly sessionId: () => string | undefined
}

export interface TaskJobWidgetFeed {
  observe(change: StoreMutation): void
  sync(): void
  dispose(): void
}

type TaskJob = {
  readonly handle: JobWidgetSourceHandle
  readonly tap: JobWidgetTextTap
  readonly brief: JobWidgetBriefText
  watch: string | undefined
  unsubscribe: (() => void) | undefined
}

// Offers each running background task of this session to senpi's job widgets: the child's finished
// tool calls feed one `tools` tap, its background commands set the `watch` hint, the task's terminal
// status settles the widget, and a removed record, a session change or the feed's disposal forgets it.
export function createTaskJobWidgetFeed(deps: TaskJobWidgetFeedDeps): TaskJobWidgetFeed {
  const jobs = new Map<string, TaskJob>()
  const settled = new Set<string>()
  const declined = new Set<string>()
  let boundSession: string | undefined

  const forget = (taskId: string): void => {
    const job = jobs.get(taskId)
    jobs.delete(taskId)
    settled.delete(taskId)
    declined.delete(taskId)
    if (job === undefined) return
    job.unsubscribe?.()
    job.handle.dispose()
  }
  const forgetAll = (): void => {
    for (const taskId of [...jobs.keys()]) forget(taskId)
    declined.clear()
  }
  const settle = (taskId: string): void => {
    const job = jobs.get(taskId)
    if (job === undefined || settled.has(taskId)) return
    settled.add(taskId)
    job.unsubscribe?.()
    job.unsubscribe = undefined
    job.tap.close()
    job.handle.settle()
  }
  const register = (sessionId: string, record: TaskRecord): void => {
    const tap = deps.sources.createTap(TASK_TOOLS_SOURCE_ID, TASK_TOOLS_SOURCE_LABEL)
    const brief = taskBrief(record)
    const handle = deps.sources.register({
      sessionId,
      id: record.task_id,
      kind: "task",
      sources: [tap],
      brief,
      startedAtMs: startedAtMs(record),
    })
    if (handle === undefined) {
      declined.add(record.task_id)
      return
    }
    const job: TaskJob = { handle, tap, brief, watch: undefined, unsubscribe: undefined }
    jobs.set(record.task_id, job)
    job.unsubscribe = subscribeChildToolCalls(deps.manager, record.task_id, {
      result: (entry) => {
        tap.append(entry)
        handle.notify()
      },
      backgroundCommand: (command) => {
        const watch = backgroundCommandWatch(command)
        if (watch === job.watch) return
        job.watch = watch
        handle.update({ ...job.brief, watch })
      },
    })
  }
  const accept = (sessionId: string, record: TaskRecord): void => {
    if (record.parent_session_id !== sessionId || !record.notify_on_terminal) return
    if (isTerminal(record.status)) return settle(record.task_id)
    if (record.status !== "running" || declined.has(record.task_id)) return
    if (jobs.has(record.task_id)) {
      if (!settled.has(record.task_id)) return
      // A finished task revived by task_send runs again: a fresh widget for the new run.
      forget(record.task_id)
    }
    register(sessionId, record)
  }
  const currentSession = (): string | undefined => {
    const sessionId = deps.sessionId()
    if (sessionId !== boundSession) {
      forgetAll()
      boundSession = sessionId
    }
    return sessionId
  }

  return {
    observe(change) {
      const sessionId = currentSession()
      if (sessionId === undefined) return
      if (change.record === null) return forget(change.taskId)
      accept(sessionId, change.record)
    },
    sync() {
      const sessionId = currentSession()
      if (sessionId === undefined) return
      for (const { record } of deps.manager.list({ scope: "parent-session", session_id: sessionId })) accept(sessionId, record)
    },
    dispose() {
      forgetAll()
      boundSession = undefined
    },
  }
}

type ChildToolCallSinks = {
  readonly result: (entry: string) => void
  readonly backgroundCommand: (command: string) => void
}

// The subagent knows which of its own jobs shows progress; the one signal it gives without being
// asked is starting a command in the background. The newest such command becomes the task's `watch`
// hint, so senpi authors a widget for it; a task that only reads and edits stays unauthored.
function subscribeChildToolCalls(manager: TaskJobWidgetManager, taskId: string, sinks: ChildToolCallSinks): () => void {
  const pendingArgs = new Map<string, unknown>()
  return manager.subscribeChild(taskId, (event) => {
    if (event.type === "tool_execution_start") {
      const args = event.args ?? event.input
      if (event.toolCallId !== undefined) pendingArgs.set(event.toolCallId, args)
      const command = event.toolName === "bash" ? backgroundBashCommand(args) : undefined
      if (command !== undefined) sinks.backgroundCommand(command)
      return
    }
    if (event.type !== "tool_execution_end" || typeof event.toolName !== "string") return
    const args = event.toolCallId === undefined ? undefined : pendingArgs.get(event.toolCallId)
    if (event.toolCallId !== undefined) pendingArgs.delete(event.toolCallId)
    sinks.result(formatToolCallEntry(event.toolName, args, toolResultText(event.result)))
  })
}

function backgroundBashCommand(args: unknown): string | undefined {
  if (typeof args !== "object" || args === null) return undefined
  if (Reflect.get(args, "run_in_background") !== true) return undefined
  const command: unknown = Reflect.get(args, "command")
  return typeof command === "string" && command.trim().length > 0 ? command : undefined
}

// Redacted before the cut, so a secret straddling the 300-character limit is never half shown.
export function backgroundCommandWatch(command: string): string {
  const redacted = redactCommandSecrets(command.replace(/\s+/g, " ").trim())
  const shown = redacted.length > MAX_WATCH_COMMAND_CHARS ? `${redacted.slice(0, MAX_WATCH_COMMAND_CHARS - 1)}…` : redacted
  return `background command: ${shown}`
}

function redactCommandSecrets(text: string): string {
  return redactSensitiveOutput(text)
    .replace(/(--?(?:[a-z0-9]+[-_])*(?:token|password|passwd|secret|api[-_]?key|auth)(?:=|\s+))("[^"]*"|'[^']*'|\S+)/gi, "$1[REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/g, "[REDACTED]")
}

function formatToolCallEntry(toolName: string, args: unknown, resultText: string): string {
  const text = resultText.length > MAX_TOOL_RESULT_CHARS ? resultText.slice(-MAX_TOOL_RESULT_CHARS) : resultText
  return `\n${TASK_TOOL_CALL_MARK}${formatToolActivity(toolName, args)}\n${text}\n`
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result
  if (typeof result !== "object" || result === null) return ""
  const content: unknown = Reflect.get(result, "content")
  if (!Array.isArray(content)) return ""
  return content
    .filter((part): part is { readonly type: "text"; readonly text: string } =>
      typeof part === "object" && part !== null && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
}

function taskBrief(record: TaskRecord): JobWidgetBriefText {
  const prompt = record.spawn_spec !== undefined && "prompt" in record.spawn_spec ? record.spawn_spec.prompt : undefined
  const intent = record.description ?? record.task_summary
  const task = prompt ?? intent
  return {
    ...(task === undefined ? {} : { task: task.length > MAX_ASSIGNMENT_CHARS ? `${task.slice(0, MAX_ASSIGNMENT_CHARS - 1)}…` : task }),
    ...(intent === undefined ? {} : { intent }),
  }
}

function startedAtMs(record: TaskRecord): number | undefined {
  const parsed = Date.parse(record.started_at ?? record.created_at)
  return Number.isFinite(parsed) ? parsed : undefined
}
