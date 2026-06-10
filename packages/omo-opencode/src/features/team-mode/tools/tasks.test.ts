/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"

import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { OpencodeClient } from "../../../tools/delegate-task/types"
import type { RuntimeState, Task } from "../types"

const mockClient = {} as OpencodeClient

const createTaskMock = mock(async () => ({ id: "1", subject: "task one" } as Task))
const listTasksMock = mock(async () => [{ id: "1", status: "pending" } as Task])
const claimTaskMock = mock(async () => ({ id: "1", status: "claimed" } as Task))
const updateTaskStatusMock = mock(async (_teamRunId: string, _taskId: string, status: Task["status"]) => ({
  id: "1",
  status,
} as Task))
const getTaskMock = mock(async () => ({ id: "1", status: "completed" } as Task))
const loadRuntimeStateMock = mock(async (): Promise<RuntimeState> => ({
  version: 1,
  teamRunId: "team-run-1",
  teamName: "team-alpha",
  specSource: "project",
  createdAt: 1,
  status: "active",
  leadSessionId: "lead-session",
  members: [
    { name: "lead-member", sessionId: "lead-session", agentType: "leader", status: "running", pendingInjectedMessageIds: [] },
    { name: "member-a", sessionId: "member-session-a", agentType: "general-purpose", status: "running", pendingInjectedMessageIds: [] },
  ],
  shutdownRequests: [],
  bounds: {
    maxMembers: 8,
    maxParallelMembers: 4,
    maxMessagesPerRun: 10_000,
    maxWallClockMinutes: 120,
    maxMemberTurns: 500,
  },
}))

const deps = {
  loadRuntimeState: loadRuntimeStateMock,
  createTask: createTaskMock,
  listTasks: listTasksMock,
  claimTask: claimTaskMock,
  updateTaskStatus: updateTaskStatusMock,
  getTask: getTaskMock,
}

const {
  createTeamTaskCreateTool,
  createTeamTaskListTool,
  createTeamTaskUpdateTool,
  createTeamTaskGetTool,
} = await import("./tasks")

function createConfig(): TeamModeConfig {
  return {
    enabled: true,
    tmux_visualization: false,
    max_parallel_members: 4,
    max_members: 8,
    max_messages_per_run: 10_000,
    max_wall_clock_minutes: 120,
    max_member_turns: 500,
    message_payload_max_bytes: 32_768,
    recipient_unread_max_bytes: 262_144,
    mailbox_poll_interval_ms: 3_000,
  }
}

function createContext(sessionID: string) {
  return {
    sessionID,
    messageID: "message-1",
    agent: "test-agent",
    directory: "/tmp/team-mode",
    worktree: "/tmp/team-mode/worktree",
    abort: new AbortController().signal,
    metadata: mock(() => {}),
    ask: async () => {},
  } satisfies ToolContext
}

describe("team task tools", () => {
  beforeEach(() => {
    createTaskMock.mockClear()
    listTasksMock.mockClear()
    claimTaskMock.mockClear()
    updateTaskStatusMock.mockClear()
    getTaskMock.mockClear()
    loadRuntimeStateMock.mockClear()
  })

  test("create -> list -> claim -> complete flow", async () => {
    // given
    const config = createConfig()
    const createTool = createTeamTaskCreateTool(config, mockClient, deps)
    const listTool = createTeamTaskListTool(config, mockClient, deps)
    const updateTool = createTeamTaskUpdateTool(config, mockClient, deps)
    const getTool = createTeamTaskGetTool(config, mockClient, deps)

    // when
    const created = JSON.parse(await createTool.execute({ teamRunId: "team-run-1", subject: "task one", description: "desc" }, createContext("member-session-a")))
    const listed = JSON.parse(await listTool.execute({ teamRunId: "team-run-1", status: "pending", owner: "member-a" }, createContext("member-session-a")))
    const claimed = JSON.parse(await updateTool.execute({ teamRunId: "team-run-1", taskId: "1", status: "claimed" }, createContext("member-session-a")))
    const inProgress = JSON.parse(await updateTool.execute({ teamRunId: "team-run-1", taskId: "1", status: "in_progress", owner: "member-a" }, createContext("member-session-a")))
    const completed = JSON.parse(await updateTool.execute({ teamRunId: "team-run-1", taskId: "1", status: "completed", owner: "member-a" }, createContext("member-session-a")))
    const fetched = JSON.parse(await getTool.execute({ teamRunId: "team-run-1", taskId: "1" }, createContext("member-session-a")))

    // then
    expect(created.taskId).toBe("1")
    expect(created.task.subject).toBe("task one")
    expect(listed.tasks).toHaveLength(1)
    expect(claimed.task.status).toBe("claimed")
    expect(inProgress.task.status).toBe("in_progress")
    expect(completed.task.status).toBe("completed")
    expect(fetched.task.status).toBe("completed")
    expect(createTaskMock).toHaveBeenCalledWith("team-run-1", expect.objectContaining({ subject: "task one", description: "desc", blockedBy: [], status: "pending" }), config)
    expect(listTasksMock).toHaveBeenCalledWith("team-run-1", config, { status: "pending", owner: "member-a" })
    expect(claimTaskMock).toHaveBeenCalledWith("team-run-1", "1", "member-a", config)
    expect(updateTaskStatusMock).toHaveBeenCalledWith("team-run-1", "1", "in_progress", "member-a", config)
    expect(updateTaskStatusMock).toHaveBeenCalledWith("team-run-1", "1", "completed", "member-a", config)
    expect(getTaskMock).toHaveBeenCalledWith("team-run-1", "1", config)
  })

  test("cross-owner update rejected", async () => {
    // given
    const config = createConfig()
    updateTaskStatusMock.mockImplementationOnce(async () => { throw new Error("CrossOwnerUpdateError") })
    const updateTool = createTeamTaskUpdateTool(config, mockClient, deps)

    // when
    const result = updateTool.execute({ teamRunId: "team-run-1", taskId: "1", status: "in_progress", owner: "member-b" }, createContext("member-session-a"))

    // then
    expect(result).rejects.toThrow("CrossOwnerUpdateError")
  })

  test("blockedBy enforcement", async () => {
    // given
    const config = createConfig()
    claimTaskMock.mockImplementationOnce(async () => { throw new Error("blocked by 2") })
    const updateTool = createTeamTaskUpdateTool(config, mockClient, deps)

    // when
    const result = updateTool.execute({ teamRunId: "team-run-1", taskId: "1", status: "claimed" }, createContext("member-session-a"))

    // then
    expect(result).rejects.toThrow("blocked by 2")
  })
})
