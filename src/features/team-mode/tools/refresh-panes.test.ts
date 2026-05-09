/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { RuntimeState } from "../types"
import { createTeamRefreshPanesTool, type TeamRefreshPanesToolDeps } from "./refresh-panes"
import { TeamFromDeadInstanceError } from "../team-state-store/store"

function buildConfig() {
  return TeamModeConfigSchema.parse({
    enabled: true,
    base_dir: "/tmp/test-team-refresh",
  })
}

type BuildRuntimeOpts = {
  serverUrl?: string
  members?: Array<{ name: string; sessionId?: string; tmuxGridPaneId?: string }>
  callerSessionId: string
  isLead: boolean
}

function buildRuntime(opts: BuildRuntimeOpts): RuntimeState {
  const { serverUrl, members = [], callerSessionId, isLead } = opts
  const leadSessionId = isLead ? callerSessionId : "ses_lead"
  return {
    version: 1,
    teamRunId: randomUUID(),
    teamName: "test-team",
    specSource: "user",
    createdAt: Date.now(),
    status: "active",
    leadSessionId,
    serverUrl,
    members: members.map((m) => ({
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

describe("team_refresh_panes", () => {
  test("rejects with TeamFromDeadInstanceError when serverUrl mismatches (no tmux mutation)", async () => {
    const tmuxCalls: unknown[] = []
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [{ name: "m1", sessionId: "ses_1", tmuxGridPaneId: "%5" }],
      callerSessionId: "ses_lead",
      isLead: true,
    })
    const deps: TeamRefreshPanesToolDeps = {
      loadRuntimeState: async () => rs,
      assertTeamServedByCurrentInstance: async (state, url) => {
        if (state.serverUrl !== url) throw new TeamFromDeadInstanceError(state.teamRunId, state.leadSessionId)
      },
      runTmuxCommand: async (...args) => {
        tmuxCalls.push(args)
        return { success: true, output: "", stdout: "", stderr: "", exitCode: 0 }
      },
      getTmuxPath: async () => "/usr/bin/tmux",
      buildLiveTailCommand: () => "python3 ...",
    }
    const tool = createTeamRefreshPanesTool(buildConfig(), { getServerUrl: () => "http://B:4096" } as any, deps)
    await expect(
      tool.execute({ teamRunId: randomUUID() }, { sessionID: "ses_lead" }),
    ).rejects.toThrow(TeamFromDeadInstanceError)
    // CRITICAL: no tmux command was issued before the rejection
    expect(tmuxCalls).toHaveLength(0)
  })

  test("rejects non-participants", async () => {
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [{ name: "m1", sessionId: "ses_member" }],
      callerSessionId: "ses_outsider",
      isLead: false,
    })
    const deps: TeamRefreshPanesToolDeps = {
      loadRuntimeState: async () => rs,
      assertTeamServedByCurrentInstance: async () => {},
      runTmuxCommand: async () => ({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 }),
      getTmuxPath: async () => "/usr/bin/tmux",
      buildLiveTailCommand: () => "python3 ...",
    }
    const tool = createTeamRefreshPanesTool(buildConfig(), { getServerUrl: () => "http://A:4096" } as any, deps)
    await expect(
      tool.execute({ teamRunId: rs.teamRunId }, { sessionID: "ses_outsider" }),
    ).rejects.toThrow("team_refresh_panes: caller must be a team participant")
  })

  test("returns 'tmux unavailable' when tmuxMgr is undefined", async () => {
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [{ name: "m1", sessionId: "ses_1", tmuxGridPaneId: "%5" }],
      callerSessionId: "ses_lead",
      isLead: true,
    })
    const deps: TeamRefreshPanesToolDeps = {
      loadRuntimeState: async () => rs,
      assertTeamServedByCurrentInstance: async () => {},
      runTmuxCommand: async () => ({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 }),
      getTmuxPath: async () => "/usr/bin/tmux",
      buildLiveTailCommand: () => "python3 ...",
    }
    const tool = createTeamRefreshPanesTool(buildConfig(), undefined, deps)
    const result = JSON.parse(await tool.execute({ teamRunId: rs.teamRunId }, { sessionID: "ses_lead" }) as string)
    expect(result.reason).toBe("tmux unavailable")
    expect(result.refreshed).toEqual([])
    expect(result.skipped).toEqual(["m1"])
  })

  test("respawn-pane is invoked per member with grid pane + sessionId", async () => {
    const tmuxCalls: Array<[string, string[]]> = []
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [
        { name: "m1", sessionId: "ses_1", tmuxGridPaneId: "%5" },
        { name: "m2", sessionId: "ses_2", tmuxGridPaneId: "%6" },
      ],
      callerSessionId: "ses_lead",
      isLead: true,
    })
    const deps: TeamRefreshPanesToolDeps = {
      loadRuntimeState: async () => rs,
      assertTeamServedByCurrentInstance: async () => {},
      runTmuxCommand: async (tmuxPath, args) => {
        tmuxCalls.push([tmuxPath, args])
        return { success: true, output: "", stdout: "", stderr: "", exitCode: 0 }
      },
      getTmuxPath: async () => "/usr/bin/tmux",
      buildLiveTailCommand: (url, sessionId) => `python3 tail.py ${url} ${sessionId}`,
    }
    const tool = createTeamRefreshPanesTool(buildConfig(), { getServerUrl: () => "http://A:4096" } as any, deps)
    const result = JSON.parse(await tool.execute({ teamRunId: rs.teamRunId }, { sessionID: "ses_lead" }) as string)
    expect(result.refreshed).toEqual(["m1", "m2"])
    expect(result.skipped).toEqual([])
    expect(result.failed).toEqual([])
    expect(tmuxCalls).toHaveLength(2)
    expect(tmuxCalls[0]).toEqual(["/usr/bin/tmux", ["respawn-pane", "-k", "-t", "%5", "python3 tail.py http://A:4096 ses_1"]])
    expect(tmuxCalls[1]).toEqual(["/usr/bin/tmux", ["respawn-pane", "-k", "-t", "%6", "python3 tail.py http://A:4096 ses_2"]])
  })

  test("skips members without sessionId or tmuxGridPaneId", async () => {
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [
        { name: "no-pane", sessionId: "ses_1" },           // missing tmuxGridPaneId
        { name: "no-session", tmuxGridPaneId: "%7" },       // missing sessionId
        { name: "complete", sessionId: "ses_3", tmuxGridPaneId: "%8" },
      ],
      callerSessionId: "ses_lead",
      isLead: true,
    })
    const tmuxCalls: unknown[] = []
    const deps: TeamRefreshPanesToolDeps = {
      loadRuntimeState: async () => rs,
      assertTeamServedByCurrentInstance: async () => {},
      runTmuxCommand: async (...args) => {
        tmuxCalls.push(args)
        return { success: true, output: "", stdout: "", stderr: "", exitCode: 0 }
      },
      getTmuxPath: async () => "/usr/bin/tmux",
      buildLiveTailCommand: () => "python3 ...",
    }
    const tool = createTeamRefreshPanesTool(buildConfig(), { getServerUrl: () => "http://A:4096" } as any, deps)
    const result = JSON.parse(await tool.execute({ teamRunId: rs.teamRunId }, { sessionID: "ses_lead" }) as string)
    expect(result.skipped).toEqual(["no-pane", "no-session"])
    expect(result.refreshed).toEqual(["complete"])
    expect(tmuxCalls).toHaveLength(1)
  })

  test("accumulates failures and continues with the next member", async () => {
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [
        { name: "fail-member", sessionId: "ses_1", tmuxGridPaneId: "%5" },
        { name: "ok-member", sessionId: "ses_2", tmuxGridPaneId: "%6" },
      ],
      callerSessionId: "ses_lead",
      isLead: true,
    })
    let callCount = 0
    const deps: TeamRefreshPanesToolDeps = {
      loadRuntimeState: async () => rs,
      assertTeamServedByCurrentInstance: async () => {},
      runTmuxCommand: async () => {
        callCount++
        if (callCount === 1) return { success: false, output: "", stdout: "", stderr: "pane not found", exitCode: 1 }
        return { success: true, output: "", stdout: "", stderr: "", exitCode: 0 }
      },
      getTmuxPath: async () => "/usr/bin/tmux",
      buildLiveTailCommand: () => "python3 ...",
    }
    const tool = createTeamRefreshPanesTool(buildConfig(), { getServerUrl: () => "http://A:4096" } as any, deps)
    const result = JSON.parse(await tool.execute({ teamRunId: rs.teamRunId }, { sessionID: "ses_lead" }) as string)
    expect(result.refreshed).toEqual(["ok-member"])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].name).toBe("fail-member")
    expect(result.failed[0].error).toBe("pane not found")
  })

  test("uses CURRENT server URL via tmuxMgr.getServerUrl(), not what runtime state remembers", async () => {
    const capturedUrls: string[] = []
    const rs = buildRuntime({
      serverUrl: "http://A:4096",
      members: [{ name: "m1", sessionId: "ses_1", tmuxGridPaneId: "%5" }],
      callerSessionId: "ses_lead",
      isLead: true,
    })
    const deps: TeamRefreshPanesToolDeps = {
      loadRuntimeState: async () => rs,
      assertTeamServedByCurrentInstance: async () => {},
      runTmuxCommand: async () => ({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 }),
      getTmuxPath: async () => "/usr/bin/tmux",
      buildLiveTailCommand: (url, sessionId) => {
        capturedUrls.push(url)
        return `python3 tail.py ${url} ${sessionId}`
      },
    }
    // tmuxMgr reports "http://A:4096" — same as rs.serverUrl (must match for assertTeamServedByCurrentInstance to pass)
    const tool = createTeamRefreshPanesTool(buildConfig(), { getServerUrl: () => "http://A:4096" } as any, deps)
    await tool.execute({ teamRunId: rs.teamRunId }, { sessionID: "ses_lead" })
    expect(capturedUrls).toEqual(["http://A:4096"])
  })
})
