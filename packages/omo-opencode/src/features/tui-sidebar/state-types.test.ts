import { describe, expect, it } from "bun:test"

import { assertNever } from "./state-types"
import type {
  AgentsState,
  ConfigBanner,
  ConfigState,
  JobBoardState,
  LoopState,
  RosterState,
  SidebarView,
} from "./state-types"

function describeConfigState(state: ConfigState): string {
  switch (state.kind) {
    case "valid":
      return "valid"
    case "invalid":
      return state.messages.join("\n")
    default:
      return assertNever(state)
  }
}

function describeRosterState(state: RosterState): string {
  switch (state.kind) {
    case "empty":
      return "empty"
    case "rows":
      return state.rows.map((row) => `${row.label}:${row.model}`).join(",")
    default:
      return assertNever(state)
  }
}

function describeAgentsState(state: AgentsState): string {
  switch (state.kind) {
    case "none":
      return "none"
    case "list":
      return state.agents.map((agent) => `${agent.name}:${agent.status}`).join(",")
    default:
      return assertNever(state)
  }
}

function describeJobBoardState(state: JobBoardState): string {
  switch (state.kind) {
    case "none":
      return "none"
    case "list":
      return state.jobs.map((job) => `${job.title}:${job.status}`).join(",")
    default:
      return assertNever(state)
  }
}

function describeLoopState(state: LoopState): string {
  switch (state.kind) {
    case "none":
      return "none"
    case "live":
      return `${state.goalsDone}/${state.goalsTotal}`
    default:
      return assertNever(state)
  }
}

function describeConfigBanner(banner: ConfigBanner): string {
  switch (banner.kind) {
    case "none":
      return "none"
    case "invalid":
      return "invalid"
    default:
      return assertNever(banner)
  }
}

function describeSidebarView(view: SidebarView): string {
  switch (view.kind) {
    case "active":
      return [
        describeLoopState(view.loop),
        describeAgentsState(view.agents),
        describeJobBoardState(view.jobs),
        describeConfigBanner(view.configBanner),
      ].join("|")
    case "broken":
      return view.messages.join("\n")
    case "idle":
      return describeRosterState(view.roster)
    default:
      return assertNever(view)
  }
}

describe("tui sidebar state types", () => {
  it("#given every sidebar view variant #when switched exhaustively #then assertNever typechecks the defaults", () => {
    // given
    const active: SidebarView = {
      kind: "active",
      loop: {
        kind: "live",
        goalsDone: 1,
        goalsTotal: 2,
        pass: 3,
        fail: 0,
        pending: 1,
        blocked: 0,
        activeGoal: null,
      },
      agents: {
        kind: "list",
        agents: [{ name: "sisyphus", status: "busy" }],
      },
      jobs: {
        kind: "list",
        jobs: [
          {
            title: "Summarize",
            status: "completed",
            toolCalls: null,
            lastTool: null,
          },
        ],
      },
      configBanner: { kind: "invalid" },
    }
    const broken: SidebarView = {
      kind: "broken",
      messages: ["config invalid"],
    }
    const idle: SidebarView = {
      kind: "idle",
      roster: { kind: "rows", rows: [{ label: "sisyphus", model: "gpt-5" }] },
    }

    // when
    const descriptions = [active, broken, idle].map(describeSidebarView)

    // then
    expect(descriptions).toEqual([
      "1/2|sisyphus:busy|Summarize:completed|invalid",
      "config invalid",
      "sisyphus:gpt-5",
    ])
    expect(describeConfigState({ kind: "valid" })).toBe("valid")
    expect(describeConfigState({ kind: "invalid", messages: ["bad"] })).toBe("bad")
  })
})
