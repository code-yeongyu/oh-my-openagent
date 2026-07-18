import { describe, expect, it } from "bun:test"

import { TeamModeConfigSchema } from "@oh-my-opencode/team-core/config"
import { RuntimeStateSchema } from "@oh-my-opencode/team-core/types"

import { buildTuiRuntimeSnapshot } from "./snapshot-builder"
import type { TeamRuntimeProvider } from "./team-projection"
import type { TuiBackgroundSnapshotProvider, TuiMirrorClient } from "./snapshot-builder"

const TEAM_RUN_ID = "11111111-1111-4111-8111-111111111111"
const enabledTeamMode = TeamModeConfigSchema.parse({ enabled: true })
const disabledTeamMode = TeamModeConfigSchema.parse({ enabled: false })
const idleBackgroundManager: TuiBackgroundSnapshotProvider = {
  getTasksSnapshot: () => [],
}

function runtimeProvider(sessionID: string, calls?: string[]): TeamRuntimeProvider {
  return {
    listActiveTeams: async () => {
      calls?.push("listActiveTeams")
      return [{ teamRunId: TEAM_RUN_ID, teamName: "sidebar-team", status: "active", memberCount: 1, scope: "project" }]
    },
    loadRuntimeState: async () => {
      calls?.push("loadRuntimeState")
      return RuntimeStateSchema.parse({
        version: 1,
        teamRunId: TEAM_RUN_ID,
        teamName: "sidebar-team",
        specSource: "project",
        createdAt: 1,
        status: "active",
        leadSessionId: sessionID,
        members: [{
          name: "lead",
          sessionId: sessionID,
          agentType: "leader",
          status: "running",
          pendingInjectedMessageIds: [],
        }],
        shutdownRequests: [],
        bounds: {
          maxMembers: 8,
          maxParallelMembers: 4,
          maxMessagesPerRun: 10_000,
          maxWallClockMinutes: 120,
          maxMemberTurns: 500,
        },
      })
    },
    listTasks: async () => {
      calls?.push("listTasks")
      return []
    },
  }
}

function clientWithList(list: NonNullable<TuiMirrorClient["session"]["list"]>): TuiMirrorClient {
  return {
    session: {
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      list,
    },
  }
}

describe("buildTuiRuntimeSnapshot Team projection", () => {
  it("#given an SDK session list method that requires its owner #when building Team state #then the call preserves its this binding", async () => {
    // given
    const projectDir = "/tmp/omo-sidebar-binding"
    const sessionID = "ses-binding"
    let ownerMatched = false
    const session = {
      status: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      async list(): Promise<unknown> {
        ownerMatched = this === session
        return { data: [{ id: sessionID, directory: projectDir }] }
      },
    }

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: { session },
      backgroundManager: idleBackgroundManager,
      teamModeConfig: enabledTeamMode,
      teamRuntimeProvider: runtimeProvider(sessionID),
    })

    // then
    expect(ownerMatched).toBe(true)
    expect(snapshot.teams).toHaveLength(1)
  })

  it("#given Team mode is disabled #when building a snapshot #then session and runtime providers are not scanned", async () => {
    // given
    const calls: string[] = []
    const client = clientWithList(async () => {
      calls.push("listSessions")
      return { data: [] }
    })

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir: "/tmp/omo-sidebar-disabled",
      client,
      backgroundManager: idleBackgroundManager,
      teamModeConfig: disabledTeamMode,
      teamRuntimeProvider: runtimeProvider("ses-disabled", calls),
    })

    // then
    expect(snapshot.teams).toEqual([])
    expect(calls).toEqual([])
  })

  it("#given the relevant Team session follows more than one hundred newer sessions #when building Team state #then the complete project-scoped list includes it", async () => {
    // given
    const projectDir = "/tmp/omo-sidebar-many-sessions"
    const relevantSessionID = "ses-relevant"
    const sessions = [
      ...Array.from({ length: 100 }, (_, index) => ({ id: `ses-newer-${index}`, directory: projectDir })),
      { id: relevantSessionID, directory: projectDir },
    ]
    let receivedQuery: { readonly directory?: string; readonly limit?: number } | undefined
    const client = clientWithList(async (options) => {
      receivedQuery = options?.query
      const limit = options?.query?.limit
      return { data: limit === 500 ? sessions : sessions.slice(0, limit ?? 100) }
    })

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client,
      backgroundManager: idleBackgroundManager,
      teamModeConfig: enabledTeamMode,
      teamRuntimeProvider: runtimeProvider(relevantSessionID),
    })

    // then
    expect(receivedQuery).toEqual({ limit: 500 })
    expect(snapshot.teams[0]?.members[0]?.sessionId).toBe(relevantSessionID)
  })
})
