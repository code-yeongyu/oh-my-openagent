import { taskIdentityLabel } from "@oh-my-opencode/senpi-task"
import type { CancelOutcome, ListScope, ListedTask, TaskRecord, TaskStatus } from "@oh-my-opencode/senpi-task"

import type { SenpiExtensionAPI } from "../../extension/types"
import { formatTaskRow } from "./status-ui"

// Cancellable = anything still holding a live/resident child worth stopping.
const CANCELLABLE_STATUSES: ReadonlySet<TaskStatus> = new Set(["running", "pending", "interrupted"])

// One limiter lease and the task behind it (the engine's lease-holder view, read structurally).
export interface LeaseHolderRow {
  readonly task_id: string
  readonly run_epoch: number
  readonly model: string
  readonly phase: "held" | "parked"
  readonly status?: TaskStatus
  readonly residency_state?: string
  readonly record_run_epoch?: number
  readonly live: boolean
}

// The manager read/act seam the commands need: a scoped list plus cancellation, and the lease view.
export interface CommandManager {
  list(scope: ListScope): readonly ListedTask[]
  cancelTask(idOrName: string, reason?: string): Promise<CancelOutcome>
  leaseHolders?(): readonly LeaseHolderRow[]
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
    description: "List session tasks (--all for every session, --leases for the task limiter's lease holders).",
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
  const flags = args.trim().split(/\s+/)
  if (flags.includes("--leases")) {
    ctx.ui?.notify(leaseHoldersText(manager), "info")
    return
  }
  const allScope = flags.includes("--all")
  const records = collect(manager, scopeFor(ctx, allScope))
  let text: string
  if (records.length > 0) text = records.map(formatTaskRow).join("\n")
  else if (allScope) text = "No tasks in all sessions."
  else text = emptySessionTasksText(collect(manager, scopeFor(ctx, true)).length)
  ctx.ui?.notify(text, "info")
}

// Every lease the task limiter counts, across sessions: a lease whose run ended or whose child is not
// live is one nothing will release, so it is marked (#11677).
function leaseHoldersText(manager: CommandManager): string {
  if (manager.leaseHolders === undefined) return "This task engine does not report its limiter leases."
  const holders = manager.leaseHolders()
  if (holders.length === 0) return "No task limiter leases are held."
  const rows = holders.map((holder) => {
    const ended = holder.record_run_epoch !== undefined && holder.record_run_epoch !== holder.run_epoch
    const orphaned = holder.phase === "held" && (!holder.live || ended)
    const state = holder.status === undefined ? "record missing" : `${holder.status} ${holder.residency_state ?? ""}`.trim()
    return `${holder.task_id} epoch ${holder.run_epoch} ${holder.phase} (${state}, ${holder.live ? "live" : "no live child"}${ended ? `, run ${holder.record_run_epoch} is current` : ""}) ${holder.model}${orphaned ? " ORPHANED" : ""}`
  })
  const orphans = rows.filter((row) => row.endsWith(" ORPHANED")).length
  return [`${holders.length} task limiter lease${holders.length === 1 ? "" : "s"} held${orphans === 0 ? "" : `, ${orphans} with no live run behind ${orphans === 1 ? "it" : "them"}`}:`, ...rows].join("\n")
}

// An empty session scope is not an empty store: a restart, a second pane, or a run started
// elsewhere all land here, so name the --all escape hatch and how many tasks it would show.
function emptySessionTasksText(otherSessionCount: number): string {
  const hint = "/tasks --all lists every session's tasks"
  if (otherSessionCount === 0) return `No tasks in this session. ${hint}.`
  return `No tasks in this session. ${hint} (${otherSessionCount} in other sessions).`
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
  const selected = cancellable[options.indexOf(choice)]
  if (selected === undefined) return
  const taskId = selected.task_id
  const confirmed = await ui.confirm("Cancel task", `Cancel ${taskId}?`)
  if (!confirmed) return
  await manager.cancelTask(taskId, KILL_REASON)
  ui.notify(`Cancelled ${taskId}.`, "info")
}

function killOption(record: TaskRecord): string {
  const identity = taskIdentityLabel({ taskId: record.task_id, name: record.name, description: record.description, taskSummary: record.task_summary })
  const idSuffix = identity === record.task_id ? "" : ` (${record.task_id})`
  return `${identity}${idSuffix} ${record.status}`
}
