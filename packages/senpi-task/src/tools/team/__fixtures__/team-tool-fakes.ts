import type { RuntimeState, Task } from "@oh-my-opencode/team-core/types"

import type { CreateTeamResult, CreatedMemberInfo, DeleteTeamResult, SendTeamMessageResult } from "../../../team"
import type { ActiveTeamSummary, TeamToolsService } from "../types"

export type ServiceCall = { readonly method: string; readonly args: readonly unknown[] }

// A recording fake for the team-tools service. Every method throws "unexpected" by default so a tool
// under test must be pointed at exactly the calls it should make; override only the methods a case
// exercises. All calls are recorded so tests assert the closure-bound arguments (team run id, from).
export type FakeTeamService = TeamToolsService & { readonly calls: ServiceCall[] }

export function createFakeTeamService(overrides: Partial<TeamToolsService> = {}): FakeTeamService {
  const calls: ServiceCall[] = []
  const record = <T>(method: string, args: readonly unknown[], impl: (() => T | Promise<T>) | undefined): Promise<T> => {
    calls.push({ method, args })
    if (impl === undefined) return Promise.reject(new Error(`fake team service: ${method} not stubbed`))
    return Promise.resolve(impl())
  }
  return {
    calls,
    createTeam: (input) => record("createTeam", [input], overrides.createTeam && (() => overrides.createTeam!(input))),
    deleteTeam: (input) => record("deleteTeam", [input], overrides.deleteTeam && (() => overrides.deleteTeam!(input))),
    sendMessage: (teamRunId, input) =>
      record("sendMessage", [teamRunId, input], overrides.sendMessage && (() => overrides.sendMessage!(teamRunId, input))),
    status: (teamRunId) => record("status", [teamRunId], overrides.status && (() => overrides.status!(teamRunId))),
    listTeams: () => record("listTeams", [], overrides.listTeams && (() => overrides.listTeams!())),
    createTask: (teamRunId, input) =>
      record("createTask", [teamRunId, input], overrides.createTask && (() => overrides.createTask!(teamRunId, input))),
    listTasks: (teamRunId, filter) =>
      record("listTasks", [teamRunId, filter], overrides.listTasks && (() => overrides.listTasks!(teamRunId, filter))),
    updateTask: (input) => record("updateTask", [input], overrides.updateTask && (() => overrides.updateTask!(input))),
    getTask: (teamRunId, taskId) =>
      record("getTask", [teamRunId, taskId], overrides.getTask && (() => overrides.getTask!(teamRunId, taskId))),
    requestShutdown: (teamRunId, member) =>
      record("requestShutdown", [teamRunId, member], overrides.requestShutdown && (() => overrides.requestShutdown!(teamRunId, member))),
    approveShutdown: (teamRunId, member) =>
      record("approveShutdown", [teamRunId, member], overrides.approveShutdown && (() => overrides.approveShutdown!(teamRunId, member))),
    rejectShutdown: (teamRunId, member, reason) =>
      record("rejectShutdown", [teamRunId, member, reason], overrides.rejectShutdown && (() => overrides.rejectShutdown!(teamRunId, member, reason))),
  }
}

export function fakeRuntimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    version: 1,
    teamRunId: "00000000-0000-4000-8000-000000000000",
    teamName: "demo",
    specSource: "user",
    createdAt: 1,
    status: "active",
    members: [
      { name: "alpha", agentType: "general-purpose", status: "running", pendingInjectedMessageIds: [] },
      { name: "beta", agentType: "general-purpose", status: "idle", pendingInjectedMessageIds: [] },
    ],
    shutdownRequests: [],
    bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
    ...overrides,
  }
}

export function fakeTask(overrides: Partial<Task> = {}): Task {
  return {
    version: 1,
    id: "task-1",
    subject: "do the thing",
    description: "details",
    status: "pending",
    blocks: [],
    blockedBy: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

export function fakeCreatedMember(overrides: Partial<CreatedMemberInfo> = {}): CreatedMemberInfo {
  return {
    name: "alpha",
    taskId: "st_a",
    status: "running",
    role: { kind: "category", category: "deep" },
    ...overrides,
  }
}

export function fakeCreateResult(overrides: Partial<CreateTeamResult> = {}): CreateTeamResult {
  return {
    runtimeState: fakeRuntimeState(),
    memberTaskIds: { alpha: "st_a", beta: "st_b" },
    members: [
      fakeCreatedMember(),
      fakeCreatedMember({ name: "beta", taskId: "st_b", status: "idle", role: { kind: "subagent_type", subagentType: "sisyphus" } }),
    ],
    ...overrides,
  }
}

export function fakeDeleteResult(overrides: Partial<DeleteTeamResult> = {}): DeleteTeamResult {
  return { teamRunId: "00000000-0000-4000-8000-000000000000", cancelledTaskIds: ["st_a"], ...overrides }
}

export function fakeSummary(overrides: Partial<ActiveTeamSummary> = {}): ActiveTeamSummary {
  return { teamRunId: "run-1", teamName: "demo", status: "active", memberCount: 2, scope: "user", ...overrides }
}

export function fakeSendResult(result: SendTeamMessageResult): SendTeamMessageResult {
  return result
}
