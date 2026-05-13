/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"

mock.module("../../shared/logger", () => ({ log: (..._args: unknown[]) => {} }))
mock.module("../../shared/tmux", () => ({
  runTmuxCommand: async () => ({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 }),
}))

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { RuntimeState } from "./types"
import { recoverStaleTeamPanes, type RecoverStaleTeamPanesDeps } from "./team-pane-url-recovery"
import type { TmuxCommandResult } from "../../shared/tmux"
import { TeamFromDeadInstanceError } from "./team-state-store/store"

function buildConfig() {
  return TeamModeConfigSchema.parse({ enabled: true, base_dir: "/tmp/test-pane-recovery" })
}

function buildRuntime(opts: {
  serverUrl?: string
  members?: Array<{ name: string; sessionId?: string; tmuxGridPaneId?: string }>
}): RuntimeState {
  return {
    version: 1,
    teamRunId: randomUUID(),
    teamName: "test-team",
    specSource: "user",
    createdAt: Date.now(),
    status: "active",
    leadSessionId: "ses_lead",
    serverUrl: opts.serverUrl,
    members: (opts.members ?? []).map((m) => ({
      name: m.name,
      agentType: "general-purpose" as const,
      status: "running" as const,
      sessionId: m.sessionId,
      tmuxGridPaneId: m.tmuxGridPaneId,
      pendingInjectedMessageIds: [],
    })),
    shutdownRequests: [],
    messageCount: 0,
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 1000,
      maxMemberTurns: 500,
      maxWallClockMinutes: 120,
    },
  }
}

const noop = async (): Promise<TmuxCommandResult> => ({
  success: true,
  output: "",
  stdout: "",
  stderr: "",
  exitCode: 0,
})

function buildDeps(overrides: Partial<RecoverStaleTeamPanesDeps> = {}): RecoverStaleTeamPanesDeps {
  return {
    listActiveTeams: async () => [],
    loadRuntimeState: async () => buildRuntime({}),
    runTmuxCommand: noop,
    getTmuxPath: async () => "/usr/bin/tmux",
    buildLiveTailCommand: (url, sessionId) => `python3 tail.py ${url} ${sessionId}`,
    ...overrides,
  }
}

describe("recoverStaleTeamPanes", () => {
  test("no-op when tmuxMgr is undefined", async () => {
    const tmuxCalls: unknown[] = []
    await recoverStaleTeamPanes(
      buildConfig(),
      undefined,
      buildDeps({
        listActiveTeams: async () => [
          { teamRunId: "t1", teamName: "team", status: "active", memberCount: 1, scope: "user" },
        ],
        runTmuxCommand: async (...args) => {
          tmuxCalls.push(args)
          return noop()
        },
      }),
    )
    expect(tmuxCalls).toHaveLength(0)
  })

  test("no-op when no teams exist", async () => {
    const tmuxCalls: unknown[] = []
    await recoverStaleTeamPanes(
      buildConfig(),
      { getServerUrl: () => "http://A:4096" } as any,
      buildDeps({
        listActiveTeams: async () => [],
        runTmuxCommand: async (...args) => {
          tmuxCalls.push(args)
          return noop()
        },
      }),
    )
    expect(tmuxCalls).toHaveLength(0)
  })

  test("no-op when serverUrl matches current URL", async () => {
    const tmuxCalls: unknown[] = []
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [{ name: "m1", sessionId: "ses_1", tmuxGridPaneId: "%5" }],
    })
    await recoverStaleTeamPanes(
      buildConfig(),
      { getServerUrl: () => "http://A:4096" } as any,
      buildDeps({
        listActiveTeams: async () => [
          { teamRunId: rs.teamRunId, teamName: "test-team", status: "active", memberCount: 1, scope: "user" },
        ],
        loadRuntimeState: async () => rs,
        runTmuxCommand: async (...args) => {
          tmuxCalls.push(args)
          return noop()
        },
      }),
    )
    expect(tmuxCalls).toHaveLength(0)
  })

  test("calls runTmuxCommand with respawn-pane -k when serverUrl differs", async () => {
    const tmuxCalls: Array<[string, string[]]> = []
    const rs = buildRuntime({
      serverUrl: "http://OLD:4096",
      members: [
        { name: "m1", sessionId: "ses_1", tmuxGridPaneId: "%5" },
        { name: "m2", sessionId: "ses_2", tmuxGridPaneId: "%6" },
      ],
    })
    await recoverStaleTeamPanes(
      buildConfig(),
      { getServerUrl: () => "http://NEW:4096" } as any,
      buildDeps({
        listActiveTeams: async () => [
          { teamRunId: rs.teamRunId, teamName: "test-team", status: "active", memberCount: 2, scope: "user" },
        ],
        loadRuntimeState: async () => rs,
        runTmuxCommand: async (tmuxPath, args) => {
          tmuxCalls.push([tmuxPath, args])
          return noop()
        },
        buildLiveTailCommand: (url, sessionId) => `python3 tail.py ${url} ${sessionId}`,
      }),
    )
    expect(tmuxCalls).toHaveLength(2)
    expect(tmuxCalls[0]).toEqual([
      "/usr/bin/tmux",
      ["respawn-pane", "-k", "-t", "%5", "python3 tail.py http://NEW:4096 ses_1"],
    ])
    expect(tmuxCalls[1]).toEqual([
      "/usr/bin/tmux",
      ["respawn-pane", "-k", "-t", "%6", "python3 tail.py http://NEW:4096 ses_2"],
    ])
  })

  test("skips members whose tmuxGridPaneId is missing", async () => {
    const tmuxCalls: unknown[] = []
    const rs = buildRuntime({
      serverUrl: "http://OLD:4096",
      members: [
        { name: "no-pane", sessionId: "ses_1" },        // missing tmuxGridPaneId
        { name: "no-session", tmuxGridPaneId: "%7" },    // missing sessionId
        { name: "complete", sessionId: "ses_3", tmuxGridPaneId: "%8" },
      ],
    })
    await recoverStaleTeamPanes(
      buildConfig(),
      { getServerUrl: () => "http://NEW:4096" } as any,
      buildDeps({
        listActiveTeams: async () => [
          { teamRunId: rs.teamRunId, teamName: "test-team", status: "active", memberCount: 3, scope: "user" },
        ],
        loadRuntimeState: async () => rs,
        runTmuxCommand: async (...args) => {
          tmuxCalls.push(args)
          return noop()
        },
      }),
    )
    // Only "complete" has both paneId and sessionId
    expect(tmuxCalls).toHaveLength(1)
  })

  test("skips dead-instance teams via TeamFromDeadInstanceError", async () => {
    const tmuxCalls: unknown[] = []
    const rs = buildRuntime({
      serverUrl: "http://DEAD:4096",
      members: [{ name: "m1", sessionId: "ses_1", tmuxGridPaneId: "%5" }],
    })
    await recoverStaleTeamPanes(
      buildConfig(),
      { getServerUrl: () => "http://NEW:4096" } as any,
      buildDeps({
        listActiveTeams: async () => [
          { teamRunId: rs.teamRunId, teamName: "test-team", status: "active", memberCount: 1, scope: "user" },
        ],
        loadRuntimeState: async () => {
          throw new TeamFromDeadInstanceError(rs.teamRunId, rs.leadSessionId)
        },
        runTmuxCommand: async (...args) => {
          tmuxCalls.push(args)
          return noop()
        },
      }),
    )
    expect(tmuxCalls).toHaveLength(0)
  })
})
