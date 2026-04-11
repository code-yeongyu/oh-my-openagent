import type { BeadsRuntimeTaskMetadata } from "../../features/beads-runtime"
import type { BackgroundTask } from "../../features/background-agent"

function normalizeBeadsRuntime(
  task: BackgroundTask,
): BeadsRuntimeTaskMetadata | undefined {
  const beadID = task.beadsRuntime?.beadID?.trim()
  if (!beadID) {
    return undefined
  }

  return {
    beadID,
    ...(task.beadsRuntime?.sourceCommand !== undefined ? { sourceCommand: task.beadsRuntime.sourceCommand } : {}),
    ...(task.beadsRuntime?.worktreePath !== undefined ? { worktreePath: task.beadsRuntime.worktreePath } : {}),
    ...(task.beadsRuntime?.lastReconciledAt !== undefined ? { lastReconciledAt: task.beadsRuntime.lastReconciledAt } : {}),
  }
}

export function buildBeadsRuntimeOutputMetadata(
  task: BackgroundTask,
): Record<string, unknown> {
  const beadsRuntime = normalizeBeadsRuntime(task)
  return beadsRuntime ? { beadsRuntime } : {}
}

export function formatBeadsRuntimeTableRows(task: BackgroundTask): string {
  const beadsRuntime = normalizeBeadsRuntime(task)
  if (!beadsRuntime) {
    return ""
  }

  const rows = [`| Bead ID | \`${beadsRuntime.beadID}\` |`]
  if (beadsRuntime.sourceCommand) {
    rows.push(`| Bead Source Command | \`${beadsRuntime.sourceCommand}\` |`)
  }
  if (beadsRuntime.worktreePath) {
    rows.push(`| Bead Worktree | \`${beadsRuntime.worktreePath}\` |`)
  }
  if (beadsRuntime.lastReconciledAt) {
    rows.push(`| Bead Last Reconciled | \`${beadsRuntime.lastReconciledAt}\` |`)
  }

  return `\n${rows.join("\n")}`
}

export function formatBeadsRuntimeDetailLines(task: BackgroundTask): string[] {
  const beadsRuntime = normalizeBeadsRuntime(task)
  if (!beadsRuntime) {
    return []
  }

  const lines = [`Bead ID: ${beadsRuntime.beadID}`]
  if (beadsRuntime.sourceCommand) {
    lines.push(`Bead Source Command: ${beadsRuntime.sourceCommand}`)
  }
  if (beadsRuntime.worktreePath) {
    lines.push(`Bead Worktree: ${beadsRuntime.worktreePath}`)
  }
  if (beadsRuntime.lastReconciledAt) {
    lines.push(`Bead Last Reconciled: ${beadsRuntime.lastReconciledAt}`)
  }

  return lines
}
