/// <reference types="bun-types" />

import { mock } from "bun:test"
import { randomUUID } from "node:crypto"

import type { ToolContext } from "@opencode-ai/plugin/tool"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import type { BackgroundManager } from "../../background-agent/manager"
import type { RuntimeState, TeamSpec } from "../types"

const runtimes = new Map<string, RuntimeState>()
const teamRuns = new Map<string, string>()
let nextTeamRunNumber = 1

function clone<TValue>(value: TValue): TValue {
  return structuredClone(value)
}

export function parseToolResult<TValue>(value: string): TValue {
  return JSON.parse(value) as TValue
}

export function createToolContext(sessionID: string): ToolContext {
  return {
    sessionID,
    messageID: randomUUID(),
    agent: "test-agent",
    directory: "/project",
    worktree: "/project",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => undefined,
  }
}

export function getLatestShutdownRequest(
  runtimeState: RuntimeState,
  memberName: string,
): RuntimeState["shutdownRequests"][number] | undefined {
  for (let index = runtimeState.shutdownRequests.length - 1; index >= 0; index -= 1) {
    const shutdownRequest = runtimeState.shutdownRequests[index]
    if (shutdownRequest?.memberId === memberName) {
      return shutdownRequest
    }
  }
}

export function createSpec(): TeamSpec {
  return {
    version: 1,
    name: "alpha-team",
    createdAt: 1,
    leadAgentId: "lead",
    members: [
      { kind: "category", name: "lead", category: "deep", prompt: "Lead the assigned work", backendType: "in-process", isActive: true },
      { kind: "category", name: "member-a", category: "quick", prompt: "Do the assigned work", backendType: "in-process", isActive: true },
    ],
  }
}

function createRuntimeState(spec: TeamSpec, leadSessionId: string, teamRunId: string): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: spec.name,
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId,
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
    members: spec.members.map((member) => ({
      name: member.name,
      sessionId: member.name === spec.leadAgentId ? undefined : `${member.name}-session`,
      tmuxPaneId: undefined,
      agentType: member.name === spec.leadAgentId ? "leader" : "general-purpose",
      status: "running",
      color: member.color,
      worktreePath: member.worktreePath,
      lastInjectedTurnMarker: `turn:${member.name}`,
      pendingInjectedMessageIds: [`msg:${member.name}`],
    })),
  }
}

export function requireRuntime(teamRunId: string): RuntimeState {
  const runtimeState = runtimes.get(teamRunId)
  if (!runtimeState) throw new Error(`missing runtime ${teamRunId}`)
  return runtimeState
}

export const createTeamRunMock = mock(async (spec: TeamSpec, leadSessionId: string) => {
  const key = `${spec.name}:${leadSessionId}`
  const existingTeamRunId = teamRuns.get(key)
  if (existingTeamRunId) return clone(requireRuntime(existingTeamRunId))
  const teamRunId = `team-run-${nextTeamRunNumber++}`
  teamRuns.set(key, teamRunId)
  const runtimeState = createRuntimeState(spec, leadSessionId, teamRunId)
  runtimes.set(teamRunId, runtimeState)
  return clone(runtimeState)
})
export const deleteTeamMock = mock(async (
  teamRunId: string,
  _config?: unknown,
  _tmuxMgr?: unknown,
  _bgMgr?: unknown,
  options?: { force?: boolean },
) => {
  const runtimeState = requireRuntime(teamRunId)
  const deletableStatuses = options?.force
    ? new Set<RuntimeState["status"]>(["active", "shutdown_requested", "deleting", "deleted", "creating", "orphaned"])
    : new Set<RuntimeState["status"]>(["active", "shutdown_requested", "deleting", "deleted"])
  if (!deletableStatuses.has(runtimeState.status)) {
    throw new Error(`team cannot be deleted from '${runtimeState.status}'`)
  }
  if (!options?.force && runtimeState.members.some((member) => member.agentType !== "leader" && member.status !== "shutdown_approved" && member.status !== "completed" && member.status !== "errored")) {
    throw new Error("members still active")
  }
  runtimes.delete(teamRunId)
  return { removedWorktrees: [], removedLayout: false }
})
export const requestShutdownOfMemberMock = mock(async (teamRunId: string, targetMemberName: string, requesterName: string) => {
  requireRuntime(teamRunId).shutdownRequests.push({ memberId: targetMemberName, requesterName, requestedAt: Date.now() })
})
export const approveShutdownMock = mock(async (teamRunId: string, memberName: string) => {
  const runtimeState = requireRuntime(teamRunId)
  const request = getLatestShutdownRequest(runtimeState, memberName)
  if (request) request.approvedAt = Date.now()
  const member = runtimeState.members.find((candidate) => candidate.name === memberName)
  if (member) member.status = "shutdown_approved"
})
export const rejectShutdownMock = mock(async (teamRunId: string, memberName: string, reason: string) => {
  const request = getLatestShutdownRequest(requireRuntime(teamRunId), memberName)
  if (request) {
    request.rejectedAt = Date.now()
    request.rejectedReason = reason
  }
})
export const loadTeamSpecMock = mock(async () => createSpec())
export const listActiveTeamsMock = mock(async () => Array.from(runtimes.values()).map((runtimeState) => ({
  teamRunId: runtimeState.teamRunId,
  teamName: runtimeState.teamName,
  status: runtimeState.status,
  memberCount: runtimeState.members.length,
  scope: runtimeState.specSource,
})))
export const loadRuntimeStateMock = mock(async (teamRunId: string) => clone(requireRuntime(teamRunId)))

export const config = TeamModeConfigSchema.parse({ enabled: true })
export const mockClient = {} as OpencodeClient
export const backgroundManager = {} as BackgroundManager

export function resetLifecycleTestState(): void {
  runtimes.clear()
  teamRuns.clear()
  nextTeamRunNumber = 1

  for (const mockedFunction of [
    createTeamRunMock,
    deleteTeamMock,
    requestShutdownOfMemberMock,
    approveShutdownMock,
    rejectShutdownMock,
    loadTeamSpecMock,
    listActiveTeamsMock,
    loadRuntimeStateMock,
  ]) {
    mockedFunction.mockClear()
  }
}

export function hasRuntime(teamRunId: string): boolean {
  return runtimes.has(teamRunId)
}
