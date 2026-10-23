import { currentRunStartEpoch, type LiveRunStats, type TaskRecord, type TaskRunStats } from "@oh-my-opencode/senpi-task"

// The subagent tree's spend for the footer (senpi#2471), maintained incrementally from task events
// instead of scanning the store. Each task contributes its earlier runs (`prior_runs_cost_usd`) plus
// its current run, and the current run has exactly ONE source keyed by its run_start_epoch: the live
// tracker while the run is unsettled, the record's run_stats once it settles - never both. A live
// figure for any other run (a tracker left over from the run a revive just folded, or one created
// ahead of its record) is ignored, so a handover never double counts and never drops a settled run.
export interface SubagentCostLedger {
  upsertRecord(record: TaskRecord): void
  remove(taskId: string): void
  upsertLive(taskId: string, live: LiveRunStats | undefined): void
  isUnsettled(taskId: string): boolean
  total(): number
  clear(): void
}

type TaskEntry = {
  readonly settledUsd: number
  readonly runStartEpoch: number | undefined
  readonly unsettled: boolean
  readonly liveUsd: number
}

export function createSubagentCostLedger(): SubagentCostLedger {
  const entries = new Map<string, TaskEntry>()

  return {
    upsertRecord(record) {
      const runStartEpoch = currentRunStartEpoch(record)
      const unsettled = record.run_stats === undefined
      const previous = entries.get(record.task_id)
      const keepLive = unsettled && previous?.unsettled === true && previous.runStartEpoch === runStartEpoch
      entries.set(record.task_id, {
        settledUsd: finitePositive(record.prior_runs_cost_usd) + (unsettled ? 0 : reportedCost(record.run_stats)),
        runStartEpoch,
        unsettled,
        liveUsd: keepLive ? previous.liveUsd : 0,
      })
    },
    remove(taskId) {
      entries.delete(taskId)
    },
    upsertLive(taskId, live) {
      const entry = entries.get(taskId)
      if (entry === undefined || !entry.unsettled) return
      const liveUsd = live !== undefined && live.runStartEpoch === entry.runStartEpoch ? reportedCost(live.stats) : 0
      entries.set(taskId, { ...entry, liveUsd })
    },
    isUnsettled(taskId) {
      return entries.get(taskId)?.unsettled === true
    },
    total() {
      let sum = 0
      for (const entry of entries.values()) sum += entry.settledUsd + entry.liveUsd
      return sum
    },
    clear() {
      entries.clear()
    },
  }
}

function reportedCost(stats: TaskRunStats | undefined): number {
  // "reported", and a lower-bound "partial" once the engine reports it; never unavailable or invalid.
  const status: string | undefined = stats?.cost_status
  return status === "reported" || status === "partial" ? finitePositive(stats?.cost_usd) : 0
}

function finitePositive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0
}
