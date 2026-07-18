import { MAX_AGENTS, MAX_JOBS } from "./constants"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"
import type {
  AgentsState,
  ConfigState,
  JobBoardState,
  JobRow,
  LoopState,
  RosterRow,
  RosterState,
  TeamsState,
} from "./state-types"
import type { BackgroundTaskStatus } from "../background-agent/types"

const JOB_STATUS_PRIORITY: Record<BackgroundTaskStatus, number> = {
  running: 0,
  pending: 1,
  interrupt: 2,
  error: 3,
  cancelled: 4,
  completed: 5,
}

export function deriveConfig(v: {
  readonly valid: boolean
  readonly messages: readonly string[]
}): ConfigState {
  if (v.valid) {
    return { kind: "valid" }
  }

  return { kind: "invalid", messages: [...v.messages] }
}

export function deriveRoster(rows: readonly RosterRow[]): RosterState {
  if (rows.length === 0) {
    return { kind: "empty" }
  }

  return {
    kind: "rows",
    rows: [...rows].sort(compareRosterRows).slice(0, MAX_AGENTS),
  }
}

export function deriveAgents(snap: TuiRuntimeSnapshot | null): AgentsState {
  if (!snap || snap.activeAgents.length === 0) {
    return { kind: "none" }
  }

  return {
    kind: "list",
    agents: [...snap.activeAgents].sort((left, right) => left.name.localeCompare(right.name)).slice(0, MAX_AGENTS),
  }
}

export function deriveJobBoard(snap: TuiRuntimeSnapshot | null): JobBoardState {
  if (!snap || snap.jobBoard.length === 0) {
    return { kind: "none" }
  }

  return {
    kind: "list",
    jobs: [...snap.jobBoard].sort(compareJobs).slice(0, MAX_JOBS),
  }
}

export function deriveLoop(snap: TuiRuntimeSnapshot | null): LoopState {
  return snap?.loop ?? { kind: "none" }
}

export function deriveTeams(snap: TuiRuntimeSnapshot | null): TeamsState {
  if (!snap || snap.teams.length === 0) {
    return { kind: "none" }
  }

  return { kind: "list", teams: snap.teams }
}

function compareRosterRows(left: RosterRow, right: RosterRow): number {
  return left.label.localeCompare(right.label)
}

function compareJobs(left: JobRow, right: JobRow): number {
  const priority = JOB_STATUS_PRIORITY[left.status] - JOB_STATUS_PRIORITY[right.status]
  if (priority !== 0) {
    return priority
  }

  return left.title.localeCompare(right.title)
}
