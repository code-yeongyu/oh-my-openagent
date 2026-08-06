import { describe, expect, it } from "bun:test"

import {
  deriveAgents,
  deriveConfig,
  deriveJobBoard,
  deriveLoop,
  deriveRoster,
} from "./derivers"
import { MAX_AGENTS, MAX_JOBS, MIRROR_SCHEMA_VERSION } from "./constants"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"
import type { AgentRow, JobRow, LoopLive, RosterRow } from "./state-types"

const liveLoop: LoopLive = {
  kind: "live",
  goalsDone: 2,
  goalsTotal: 5,
  pass: 3,
  fail: 1,
  pending: 4,
  blocked: 2,
  activeGoal: "Ship sidebar",
}

function snapshot(input: {
  readonly activeAgents?: readonly AgentRow[]
  readonly jobBoard?: readonly JobRow[]
  readonly loop?: LoopLive | null
}): TuiRuntimeSnapshot {
  return {
    version: MIRROR_SCHEMA_VERSION,
    projectDir: "/tmp/project",
    updatedAt: 1,
    activeAgents: [...(input.activeAgents ?? [])],
    jobBoard: [...(input.jobBoard ?? [])],
    loop: input.loop ?? null,
  }
}

function descendingRosterRows(count: number): readonly RosterRow[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = count - index - 1
    return {
      label: `Agent ${String(ordinal).padStart(2, "0")}`,
      model: `model-${ordinal}`,
    }
  })
}

function descendingAgentRows(count: number): readonly AgentRow[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = count - index - 1
    return {
      name: `agent-${String(ordinal).padStart(2, "0")}`,
      status: ordinal % 2 === 0 ? "running" : "busy",
    }
  })
}

function descendingJobRows(count: number): readonly JobRow[] {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = count - index - 1
    return {
      title: `job-${String(ordinal).padStart(2, "0")}`,
      status: "running",
      toolCalls: ordinal,
      lastTool: null,
    }
  })
}

describe("tui sidebar section derivers", () => {
  it("#given a valid config result #when deriving config #then it returns the valid state", () => {
    // given
    const result = { valid: true, messages: ["ignored"] }

    // when
    const state = deriveConfig(result)

    // then
    expect(state).toEqual({ kind: "valid" })
  })

  it("#given an invalid config result #when deriving config #then it copies messages into invalid state", () => {
    // given
    const messages = ["bad enum", "bad model"]

    // when
    const state = deriveConfig({ valid: false, messages })
    messages.push("mutated later")

    // then
    expect(state).toEqual({ kind: "invalid", messages: ["bad enum", "bad model"] })
  })

  it("#given no roster rows #when deriving roster #then it returns empty", () => {
    // given
    const rows: readonly RosterRow[] = []

    // when
    const state = deriveRoster(rows)

    // then
    expect(state).toEqual({ kind: "empty" })
  })

  it("#given unsorted oversized roster rows #when deriving roster #then it sorts by label and caps rows", () => {
    // given
    const rows = descendingRosterRows(MAX_AGENTS + 2)

    // when
    const state = deriveRoster(rows)

    // then
    expect(state.kind).toBe("rows")
    if (state.kind === "rows") {
      expect(state.rows).toHaveLength(MAX_AGENTS)
      expect(state.rows.map((row) => row.label)).toEqual(
        Array.from({ length: MAX_AGENTS }, (_, index) => `Agent ${String(index).padStart(2, "0")}`),
      )
    }
  })

  it("#given no runtime snapshot or no active agents #when deriving agents #then it returns none", () => {
    // given
    const emptySnapshot = snapshot({})

    // when
    const nullState = deriveAgents(null)
    const emptyState = deriveAgents(emptySnapshot)

    // then
    expect(nullState).toEqual({ kind: "none" })
    expect(emptyState).toEqual({ kind: "none" })
  })

  it("#given unsorted oversized active agents #when deriving agents #then it sorts by name and caps rows", () => {
    // given
    const activeAgents = descendingAgentRows(MAX_AGENTS + 2)

    // when
    const state = deriveAgents(snapshot({ activeAgents }))

    // then
    expect(state.kind).toBe("list")
    if (state.kind === "list") {
      expect(state.agents).toHaveLength(MAX_AGENTS)
      expect(state.agents.map((agent) => agent.name)).toEqual(
        Array.from({ length: MAX_AGENTS }, (_, index) => `agent-${String(index).padStart(2, "0")}`),
      )
    }
  })

  it("#given no runtime snapshot or no jobs #when deriving job board #then it returns none", () => {
    // given
    const emptySnapshot = snapshot({})

    // when
    const nullState = deriveJobBoard(null)
    const emptyState = deriveJobBoard(emptySnapshot)

    // then
    expect(nullState).toEqual({ kind: "none" })
    expect(emptyState).toEqual({ kind: "none" })
  })

  it("#given jobs with multiple statuses #when deriving job board #then it sorts by status priority then title and caps rows", () => {
    // given
    const runningJobs = descendingJobRows(MAX_JOBS + 2)
    const jobs: readonly JobRow[] = [
      { title: "z-complete", status: "completed", toolCalls: null, lastTool: null },
      { title: "b-pending", status: "pending", toolCalls: null, lastTool: null },
      { title: "a-pending", status: "pending", toolCalls: null, lastTool: null },
      { title: "a-error", status: "error", toolCalls: null, lastTool: null },
      ...runningJobs,
    ]

    // when
    const state = deriveJobBoard(snapshot({ jobBoard: jobs }))

    // then
    expect(state.kind).toBe("list")
    if (state.kind === "list") {
      expect(state.jobs).toHaveLength(MAX_JOBS)
      expect(state.jobs.map((job) => `${job.status}:${job.title}`)).toEqual(
        Array.from({ length: MAX_JOBS }, (_, index) => `running:job-${String(index).padStart(2, "0")}`),
      )
    }
  })

  it("#given no runtime snapshot or no live loop #when deriving loop #then it returns none", () => {
    // given
    const emptySnapshot = snapshot({})

    // when
    const nullState = deriveLoop(null)
    const emptyState = deriveLoop(emptySnapshot)

    // then
    expect(nullState).toEqual({ kind: "none" })
    expect(emptyState).toEqual({ kind: "none" })
  })

  it("#given a live loop with pass fail pending and blocked counts #when deriving loop #then it passes the live state through", () => {
    // given
    const stateSnapshot = snapshot({ loop: liveLoop })

    // when
    const state = deriveLoop(stateSnapshot)

    // then
    expect(state).toBe(liveLoop)
    expect(state).toEqual({
      kind: "live",
      goalsDone: 2,
      goalsTotal: 5,
      pass: 3,
      fail: 1,
      pending: 4,
      blocked: 2,
      activeGoal: "Ship sidebar",
    })
  })
})
