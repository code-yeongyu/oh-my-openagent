import { assertNever } from "./state-types"
import type {
  AgentsState,
  ConfigState,
  JobBoardState,
  LoopLive,
  LoopState,
  RosterState,
  SidebarView,
  TeamsState,
} from "./state-types"

export type ComputeViewSections = {
  readonly config: ConfigState
  readonly roster: RosterState
  readonly agents: AgentsState
  readonly jobs: JobBoardState
  readonly loop: LoopState
  readonly teams: TeamsState
}

export function computeView(sections: ComputeViewSections): SidebarView {
  if (isActive(sections)) {
    return {
      kind: "active",
      loop: sections.loop,
      agents: sections.agents,
      jobs: sections.jobs,
      teams: sections.teams,
      configBanner: sections.config.kind === "invalid" ? { kind: "invalid" } : { kind: "none" },
    }
  }

  if (sections.config.kind === "invalid") {
    return { kind: "broken", messages: sections.config.messages }
  }

  return { kind: "idle", roster: sections.roster }
}

export function viewKey(view: SidebarView): string {
  switch (view.kind) {
    case "active":
      return stableKey([
        "active",
        loopKeyParts(view.loop),
        agentsKeyParts(view.agents),
        jobsKeyParts(view.jobs),
        teamsKeyParts(view.teams),
        ["configBanner", view.configBanner.kind],
      ])
    case "broken":
      return stableKey(["broken", [...view.messages]])
    case "idle":
      return stableKey(["idle", rosterKeyParts(view.roster)])
    default:
      return assertNever(view)
  }
}

function isActive(sections: ComputeViewSections): boolean {
  return sections.agents.kind === "list"
    || sections.jobs.kind === "list"
    || sections.loop.kind === "live"
    || sections.teams.kind === "list"
}

function stableKey(parts: readonly unknown[]): string {
  return JSON.stringify(parts)
}

function rosterKeyParts(roster: RosterState): readonly unknown[] {
  switch (roster.kind) {
    case "empty":
      return ["roster", "empty"]
    case "rows":
      return ["roster", "rows", roster.rows.map((row) => [row.label, row.model])]
    default:
      return assertNever(roster)
  }
}

function agentsKeyParts(agents: AgentsState): readonly unknown[] {
  switch (agents.kind) {
    case "none":
      return ["agents", "none"]
    case "list":
      return ["agents", "list", agents.agents.map((agent) => [agent.name, agent.status])]
    default:
      return assertNever(agents)
  }
}

function jobsKeyParts(jobs: JobBoardState): readonly unknown[] {
  switch (jobs.kind) {
    case "none":
      return ["jobs", "none"]
    case "list":
      return [
        "jobs",
        "list",
        jobs.jobs.map((job) => [job.title, job.status, job.toolCalls, job.lastTool]),
      ]
    default:
      return assertNever(jobs)
  }
}

function teamsKeyParts(teams: TeamsState): readonly unknown[] {
  switch (teams.kind) {
    case "none":
      return ["teams", "none"]
    case "list":
      return [
        "teams",
        "list",
        teams.teams.map((team) => [
          team.name,
          team.members.map((member) => [member.name, member.status, member.work, member.sessionId]),
        ]),
      ]
    default:
      return assertNever(teams)
  }
}

function loopKeyParts(loop: LoopState): readonly unknown[] {
  switch (loop.kind) {
    case "none":
      return ["loop", "none"]
    case "live":
      return ["loop", "live", liveLoopKeyParts(loop)]
    default:
      return assertNever(loop)
  }
}

function liveLoopKeyParts(loop: LoopLive): readonly unknown[] {
  return [
    loop.goalsDone,
    loop.goalsTotal,
    loop.pass,
    loop.fail,
    loop.pending,
    loop.blocked,
    loop.activeGoal,
  ]
}
