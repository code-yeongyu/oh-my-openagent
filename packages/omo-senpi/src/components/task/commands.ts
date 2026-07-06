import type { CancelOutcome, ListScope, ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { formatTaskRow } from "./status-ui"

// Cancellable = anything still holding a live/resident child worth stopping.
const CANCELLABLE_STATUSES: ReadonlySet<TaskStatus> = new Set(["running", "pending", "interrupted"])

// The manager read/act seam the commands need: a scoped list plus cancellation.
export interface CommandManager {
  list(scope: ListScope): readonly ListedTask[]
  cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome>
}

// Structural slice of senpi's ExtensionCommandContext the commands read. The real context satisfies it.
interface CommandContext {
  readonly mode?: string
  readonly ui?: CommandUi
  readonly sessionManager?: { getSessionId(): string }
}

interface CommandUi {
  notify(message: string, type?: "info" | "warning" | "error"): void
  select(title: string, options: string[]): Promise<string | undefined>
  confirm(title: string, message: string): Promise<boolean>
}

const KILL_REASON = "/task-kill"

export function registerTaskCommands(pi: SenpiExtensionAPI, manager: CommandManager): void {
  pi.registerCommand("tasks", {
    description: "List session tasks (--all for every session).",
    handler: (args: string, ctx: CommandContext) => runTasksCommand(manager, args, ctx),
  })
  pi.registerCommand("task-kill", {
    description: "Cancel a session task via selector.",
    handler: (_args: string, ctx: CommandContext) => runTaskKillCommand(manager, ctx),
  })
}

function scopeFor(ctx: CommandContext, allScope: boolean): ListScope | undefined {
  if (allScope) return { scope: "all" }
  const sessionId = ctx.sessionManager?.getSessionId()
  if (sessionId === undefined) return undefined
  return { scope: "parent-session", session_id: sessionId }
}

function collect(manager: CommandManager, scope: ListScope | undefined): readonly TaskRecord[] {
  if (scope === undefined) return []
  return manager.list(scope).map((entry) => entry.record)
}

async function runTasksCommand(manager: CommandManager, args: string, ctx: CommandContext): Promise<void> {
  const allScope = args.trim().split(/\s+/).includes("--all")
  const records = collect(manager, scopeFor(ctx, allScope))
  const scopeLabel = allScope ? "all sessions" : "this session"
  const text = records.length === 0 ? `No tasks in ${scopeLabel}.` : records.map(formatTaskRow).join("\n")
  ctx.ui?.notify(text, "info")
}

async function runTaskKillCommand(manager: CommandManager, ctx: CommandContext): Promise<void> {
  const ui = ctx.ui
  if (ui === undefined) return
  const cancellable = collect(manager, scopeFor(ctx, false)).filter((record) => CANCELLABLE_STATUSES.has(record.status))
  if (cancellable.length === 0) {
    ui.notify("No cancellable tasks.", "info")
    return
  }
  const options = cancellable.map(killOption)
  const choice = await ui.select("Cancel which task?", options)
  if (choice === undefined) return
  const taskId = choice.split(" ")[0]
  if (taskId === undefined || taskId.length === 0) return
  const confirmed = await ui.confirm("Cancel task", `Cancel ${taskId}?`)
  if (!confirmed) return
  await manager.cancelTask(taskId, KILL_REASON)
  ui.notify(`Cancelled ${taskId}.`, "info")
}

function killOption(record: TaskRecord): string {
  const parts = [record.task_id]
  if (record.name !== undefined) parts.push(record.name)
  parts.push(record.status)
  return parts.join(" ")
}
