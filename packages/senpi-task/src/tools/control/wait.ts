import type { ExtensionContext, ToolDefinition } from "@code-yeongyu/senpi"
import type { OmoTaskSettings } from "@oh-my-opencode/omo-config-core"
import { Type } from "typebox"
import type { Static } from "typebox"

import type { TaskRecord } from "../../state"
import { defaultResolveCallerSessionId } from "./caller-session"
import { clampWaitTimeout } from "./clamp"
import { finalResponseHead, isTerminalStatus, toolResult } from "./tool-result"
import type {
  CallerSessionResolver,
  ScheduleTimeout,
  WaitCompletedTask,
  WaitManager,
  WaitResultDetails,
  WaitRunningTask,
  WaitTimer,
  WaitToolResult,
} from "./types"

export const TaskWaitParams = Type.Object({
  targets: Type.Optional(
    Type.Array(Type.String(), {
      description: "Task ids or names to wait on. Defaults to every child of the current session.",
    }),
  ),
  timeout_ms: Type.Optional(
    Type.Integer({ minimum: 0, description: "Deadline in ms. Clamped to the configured wait bounds; omitted uses the default." }),
  ),
})

export type TaskWaitInput = Static<typeof TaskWaitParams>

const DESCRIPTION = [
  "Wait until the first of the named child tasks reaches a terminal state (completed/error/cancelled/interrupted/lost), or until the timeout elapses.",
  "targets accepts task ids or names; omit it to wait on every child of the current session.",
  "Returns as soon as one child finishes with the others still running, so re-call to collect the rest.",
  "Reports completed tasks with a short final_response_head, the still_running tasks, and whether the wait timed out. timeout_ms is clamped to the configured bounds.",
].join(" ")

export type WaitBoundsSettings = OmoTaskSettings["wait"]

export type TaskWaitDeps = {
  readonly manager: WaitManager
  readonly waitConfig: WaitBoundsSettings
  readonly resolveCallerSessionId?: CallerSessionResolver
  readonly scheduleTimeout?: ScheduleTimeout
}

export function defaultScheduleTimeout(ms: number): WaitTimer {
  let resolveFired: () => void = () => {}
  const fired = new Promise<void>((resolve) => {
    resolveFired = resolve
  })
  const handle = setTimeout(() => resolveFired(), ms)
  handle.unref?.()
  return { fired, cancel: () => clearTimeout(handle) }
}

export async function runTaskWait(
  manager: WaitManager,
  params: TaskWaitInput,
  callerSessionId: string | undefined,
  waitConfig: WaitBoundsSettings,
  scheduleTimeout: ScheduleTimeout,
): Promise<WaitToolResult> {
  const timeoutMs = clampWaitTimeout(params.timeout_ms, waitConfig)
  const scoped = scopedRecords(manager, callerSessionId)
  const { resolved, unknown } = resolveTargets(params.targets, scoped)

  if (resolved.length === 0) {
    return buildResult([], [], false, timeoutMs, unknown)
  }

  const alreadyTerminal = resolved.filter((record) => isTerminalStatus(record.status))
  const running = resolved.filter((record) => !isTerminalStatus(record.status))
  if (alreadyTerminal.length > 0 || running.length === 0) {
    return snapshot(manager, resolved, false, timeoutMs, unknown)
  }

  const timedOut = await raceTerminal(manager, running, timeoutMs, scheduleTimeout)
  return snapshot(manager, resolved, timedOut, timeoutMs, unknown)
}

async function raceTerminal(
  manager: WaitManager,
  running: readonly TaskRecord[],
  timeoutMs: number,
  scheduleTimeout: ScheduleTimeout,
): Promise<boolean> {
  const timer = scheduleTimeout(timeoutMs)
  const completions = running.map((record) => manager.waitFor(record.task_id).then(() => "completed" as const))
  const timeout = timer.fired.then(() => "timeout" as const)
  try {
    const winner = await Promise.race([...completions, timeout])
    return winner === "timeout"
  } finally {
    timer.cancel()
  }
}

function snapshot(
  manager: WaitManager,
  resolved: readonly TaskRecord[],
  timedOut: boolean,
  timeoutMs: number,
  unknown: readonly string[],
): WaitToolResult {
  const completed: WaitCompletedTask[] = []
  const stillRunning: WaitRunningTask[] = []
  for (const record of resolved) {
    const current = manager.get(record.task_id) ?? record
    if (isTerminalStatus(current.status)) {
      const head = finalResponseHead(current.final_response)
      completed.push({ task_id: current.task_id, status: current.status, ...(head !== undefined ? { final_response_head: head } : {}) })
    } else {
      stillRunning.push({ task_id: current.task_id, status: current.status })
    }
  }
  return buildResult(completed, stillRunning, timedOut, timeoutMs, unknown)
}

function buildResult(
  completed: readonly WaitCompletedTask[],
  stillRunning: readonly WaitRunningTask[],
  timedOut: boolean,
  timeoutMs: number,
  unknown: readonly string[],
): WaitToolResult {
  const details: WaitResultDetails = {
    completed,
    still_running: stillRunning,
    timed_out: timedOut,
    timeout_ms: timeoutMs,
    ...(unknown.length > 0 ? { unknown_targets: unknown } : {}),
  }
  return toolResult(summarize(details), details)
}

function summarize(details: WaitResultDetails): string {
  const parts = [`${details.completed.length} completed, ${details.still_running.length} still running`]
  if (details.timed_out) parts.push(`timed out after ${details.timeout_ms}ms`)
  if (details.unknown_targets !== undefined) parts.push(`unknown: ${details.unknown_targets.join(", ")}`)
  return parts.join("; ")
}

function scopedRecords(manager: WaitManager, callerSessionId: string | undefined): readonly TaskRecord[] {
  const scope = callerSessionId === undefined ? ({ scope: "all" } as const) : ({ scope: "parent-session", session_id: callerSessionId } as const)
  return manager.list(scope).map((listed) => listed.record)
}

function resolveTargets(
  targets: readonly string[] | undefined,
  scoped: readonly TaskRecord[],
): { readonly resolved: readonly TaskRecord[]; readonly unknown: readonly string[] } {
  if (targets === undefined || targets.length === 0) return { resolved: scoped, unknown: [] }
  const byId = new Map(scoped.map((record) => [record.task_id, record]))
  const byName = new Map(scoped.filter((record) => record.name !== undefined).map((record) => [record.name as string, record]))
  const resolved = new Map<string, TaskRecord>()
  const unknown: string[] = []
  for (const target of targets) {
    const match = byId.get(target) ?? byName.get(target)
    if (match === undefined) unknown.push(target)
    else resolved.set(match.task_id, match)
  }
  return { resolved: [...resolved.values()], unknown }
}

export function createTaskWaitTool(deps: TaskWaitDeps): ToolDefinition<typeof TaskWaitParams, WaitResultDetails> {
  const resolveCaller = deps.resolveCallerSessionId ?? defaultResolveCallerSessionId
  const scheduleTimeout = deps.scheduleTimeout ?? defaultScheduleTimeout
  return {
    name: "task_wait",
    label: "Task Wait",
    description: DESCRIPTION,
    parameters: TaskWaitParams,
    execute: (_toolCallId, params, _signal, _onUpdate, ctx: ExtensionContext) =>
      runTaskWait(deps.manager, params, resolveCaller(ctx), deps.waitConfig, scheduleTimeout),
  }
}
