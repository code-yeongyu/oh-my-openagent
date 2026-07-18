import { describe, expect, it } from "bun:test"

import { computeView, viewKey } from "./compute-view"
import type {
  AgentsState,
  ConfigState,
  JobBoardState,
  LoopState,
  RosterState,
  SidebarView,
  TeamsState,
} from "./state-types"

const validConfig: ConfigState = { kind: "valid" }
const invalidConfig: ConfigState = {
  kind: "invalid",
  messages: ["bad agent model", "unknown sidebar flag"],
}
const roster: RosterState = {
  kind: "rows",
  rows: [{ label: "sisyphus", model: "openai/gpt-5.5" }],
}
const idleAgents: AgentsState = { kind: "none" }
const idleJobs: JobBoardState = { kind: "none" }
const idleLoop: LoopState = { kind: "none" }
const idleTeams: TeamsState = { kind: "none" }
const activeAgents: AgentsState = {
  kind: "list",
  agents: [{ name: "sisyphus", status: "busy" }],
}
const activeJobs: JobBoardState = {
  kind: "list",
  jobs: [{ title: "Review patch", status: "running", toolCalls: 2, lastTool: "grep" }],
}
const liveLoop: LoopState = {
  kind: "live",
  goalsDone: 1,
  goalsTotal: 3,
  pass: 4,
  fail: 0,
  pending: 2,
  blocked: 1,
  activeGoal: "Ship sidebar",
}

describe("tui sidebar computeView", () => {
  it("#given inactive sections and valid config #when computing view #then it returns idle with roster and no banner", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: idleLoop,
      teams: idleTeams,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({ kind: "idle", roster })
    expect("configBanner" in view).toBe(false)
  })

  it("#given inactive sections and invalid config #when computing view #then it returns broken messages", () => {
    // given
    const sections = {
      config: invalidConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: idleLoop,
      teams: idleTeams,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({ kind: "broken", messages: ["bad agent model", "unknown sidebar flag"] })
  })

  it("#given active agents and valid config #when computing view #then active precedence wins with no banner", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: activeAgents,
      jobs: idleJobs,
      loop: idleLoop,
      teams: idleTeams,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({
      kind: "active",
      loop: idleLoop,
      agents: activeAgents,
      jobs: idleJobs,
      teams: idleTeams,
      configBanner: { kind: "none" },
    })
  })

  it("#given active jobs and invalid config #when computing view #then active precedence wins with invalid banner", () => {
    // given
    const sections = {
      config: invalidConfig,
      roster,
      agents: idleAgents,
      jobs: activeJobs,
      loop: idleLoop,
      teams: idleTeams,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({
      kind: "active",
      loop: idleLoop,
      agents: idleAgents,
      jobs: activeJobs,
      teams: idleTeams,
      configBanner: { kind: "invalid" },
    })
  })

  it("#given only a live loop #when computing view #then loop activity also selects active", () => {
    // given
    const sections = {
      config: validConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: liveLoop,
      teams: idleTeams,
    }

    // when
    const view = computeView(sections)

    // then
    expect(view).toEqual({
      kind: "active",
      loop: liveLoop,
      agents: idleAgents,
      jobs: idleJobs,
      teams: idleTeams,
      configBanner: { kind: "none" },
    })
  })

  it("#given only relevant team members #when computing and keying the view #then teams activate the view and change its key", () => {
    // given
    const firstSections = {
      config: validConfig,
      roster,
      agents: idleAgents,
      jobs: idleJobs,
      loop: idleLoop,
      teams: {
        kind: "list" as const,
        teams: [{ name: "sidebar-team", members: [{ name: "idle-member", status: "idle" as const, work: "Reviewing sidebar", sessionId: "ses-member" }] }],
      },
    }
    const secondSections = {
      ...firstSections,
      teams: {
        kind: "list" as const,
        teams: [{ name: "sidebar-team", members: [{ name: "idle-member", status: "idle" as const, work: "Testing sidebar", sessionId: "ses-member" }] }],
      },
    }

    // when
    const firstView = computeView(firstSections)
    const secondView = computeView(secondSections)

    // then
    expect(firstView).toMatchObject({ kind: "active", teams: firstSections.teams })
    expect(viewKey(secondView)).not.toBe(viewKey(firstView))
  })

  it("#given equivalent views built with different literal key order #when computing keys #then viewKey is stable", () => {
    // given
    const first: SidebarView = {
      kind: "active",
      loop: liveLoop,
      agents: activeAgents,
      jobs: activeJobs,
      teams: idleTeams,
      configBanner: { kind: "invalid" },
    }
    const second: SidebarView = {
      configBanner: { kind: "invalid" },
      jobs: {
        jobs: [{ lastTool: "grep", toolCalls: 2, status: "running", title: "Review patch" }],
        kind: "list",
      },
      agents: { agents: [{ status: "busy", name: "sisyphus" }], kind: "list" },
      teams: idleTeams,
      loop: {
        activeGoal: "Ship sidebar",
        blocked: 1,
        pending: 2,
        fail: 0,
        pass: 4,
        goalsTotal: 3,
        goalsDone: 1,
        kind: "live",
      },
      kind: "active",
    }

    // when
    const firstKey = viewKey(first)
    const secondKey = viewKey(second)

    // then
    expect(secondKey).toBe(firstKey)
  })

  it("#given a changed view value #when computing keys #then viewKey changes", () => {
    // given
    const original: SidebarView = { kind: "idle", roster }
    const changed: SidebarView = {
      kind: "idle",
      roster: { kind: "rows", rows: [{ label: "atlas", model: "openai/gpt-5.5" }] },
    }

    // when
    const originalKey = viewKey(original)
    const changedKey = viewKey(changed)

    // then
    expect(changedKey).not.toBe(originalKey)
  })
})
