/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"

import type { RuntimeState } from "../types"
import {
  approveShutdownMock,
  backgroundManager,
  config,
  createSpec,
  createTeamRunMock,
  createToolContext,
  deleteTeamMock,
  getLatestShutdownRequest,
  hasRuntime,
  listActiveTeamsMock,
  loadRuntimeStateMock,
  loadTeamSpecMock,
  mockClient,
  parseToolResult,
  rejectShutdownMock,
  requestShutdownOfMemberMock,
  requireRuntime,
  resetLifecycleTestState,
} from "./lifecycle-test-fixture"

const {
  createTeamApproveShutdownTool,
  createTeamCreateTool,
  createTeamDeleteTool,
  createTeamRejectShutdownTool,
  createTeamShutdownRequestTool,
} = await import("./lifecycle")

const lifecycleDeps = {
  createTeamRun: createTeamRunMock,
  loadTeamSpec: loadTeamSpecMock,
  listActiveTeams: listActiveTeamsMock,
  loadRuntimeState: loadRuntimeStateMock,
  deleteTeam: deleteTeamMock,
  requestShutdownOfMember: requestShutdownOfMemberMock,
  approveShutdown: approveShutdownMock,
  rejectShutdown: rejectShutdownMock,
}

function createTeamCreateToolForTest() {
  return createTeamCreateTool(config, mockClient, backgroundManager, undefined, undefined, lifecycleDeps)
}

describe("team lifecycle tools", () => {
  afterAll(() => {
    mock.restore()
  })

  beforeEach(() => {
    resetLifecycleTestState()
  })

  test("team_create works without toolContext.client field", async () => {
    // given
    const teamCreateTool = createTeamCreateToolForTest()

    // when
    const result = parseToolResult<{ teamRunId: string; runtimeState: RuntimeState }>(await teamCreateTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))

    // then
    expect(result.teamRunId).toBe("team-run-1")
    expect(createTeamRunMock).toHaveBeenCalledWith(
      expect.anything(),
      "lead-session",
      expect.objectContaining({ client: mockClient }),
      config,
      backgroundManager,
      undefined,
      { callerAgentTypeId: undefined, parentMessageID: expect.any(String) },
    )
  })

  test("team_create resolves a visible sort-prefixed sisyphus caller into callerAgentTypeId", async () => {
    // given
    const teamCreateTool = createTeamCreateToolForTest()
    const toolContext = {
      ...createToolContext("lead-session"),
      agent: "00|Sisyphus",
    }

    // when
    await teamCreateTool.execute({ inline_spec: createSpec() }, toolContext)

    // then
    expect(createTeamRunMock).toHaveBeenCalledWith(
      expect.anything(),
      "lead-session",
      expect.objectContaining({ client: mockClient }),
      config,
      backgroundManager,
      undefined,
      { callerAgentTypeId: "sisyphus", parentMessageID: expect.any(String) },
    )
  })

  test("team_create returns teamRunId and sanitized runtimeState for inline specs", async () => {
    // given
    const teamCreateTool = createTeamCreateToolForTest()

    // when
    const result = parseToolResult<{ teamRunId: string; runtimeState: RuntimeState }>(await teamCreateTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))

    // then
    expect(result.teamRunId).toBe("team-run-1")
    expect(result.runtimeState.status).toBe("active")
    expect(result.runtimeState.members).toHaveLength(2)
    expect(result.runtimeState.members[0]).not.toHaveProperty("lastInjectedTurnMarker")
    expect(result.runtimeState.members[0]).not.toHaveProperty("pendingInjectedMessageIds")
  })

  test("team_create normalizes inline lead shorthand before creating the runtime", async () => {
    // given
    const teamCreateTool = createTeamCreateToolForTest()
    const inlineSpec = {
      name: "alpha-team",
      lead: { kind: "subagent_type", subagent_type: "sisyphus" },
      members: [{ kind: "category", name: "member-a", category: "quick", prompt: "Do the assigned work" }],
    }

    // when
    const result = parseToolResult<{ runtimeState: RuntimeState }>(await teamCreateTool.execute({ inline_spec: inlineSpec }, createToolContext("lead-session")))

    // then
    expect(createTeamRunMock).toHaveBeenCalledWith(
      expect.objectContaining({ leadAgentId: "lead" }),
      "lead-session",
      expect.anything(),
      config,
      expect.anything(),
      undefined,
      { callerAgentTypeId: undefined, parentMessageID: expect.any(String) },
    )
    expect(result.runtimeState.members).toHaveLength(2)
    expect(result.runtimeState.members[0]).toMatchObject({ name: "lead", agentType: "leader" })
  })

  test("team_create rejects an empty leadSessionId override", async () => {
    // given
    const teamCreateTool = createTeamCreateToolForTest()

    // when
    let errorMessage = ""
    try {
      await teamCreateTool.execute({ inline_spec: createSpec(), leadSessionId: "" }, createToolContext("lead-session"))
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error)
    }

    // then
    expect(errorMessage).toContain("leadSessionId")
  })

  test("team_delete propagates active-member errors", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const deleteTool = createTeamDeleteTool(config, mockClient, backgroundManager, undefined, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string }>(await createTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))

    // when
    const result = deleteTool.execute({ teamRunId: created.teamRunId }, createToolContext("lead-session"))

    // then
    expect(result).rejects.toThrow("members still active")
  })

  test("team_delete force=true succeeds even with active members", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const deleteTool = createTeamDeleteTool(config, mockClient, backgroundManager, undefined, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string }>(await createTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))

    // when
    const result = parseToolResult<{ deleted: boolean }>(await deleteTool.execute({ teamRunId: created.teamRunId, force: true }, createToolContext("lead-session")))

    // then
    expect(result.deleted).toBe(true)
    expect(hasRuntime(created.teamRunId)).toBe(false)
  })

  test("team_delete force=true allows non-lead caller on orphaned team", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const deleteTool = createTeamDeleteTool(config, mockClient, backgroundManager, undefined, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string }>(await createTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))
    const runtimeState = requireRuntime(created.teamRunId)
    runtimeState.status = "orphaned"
    const memberSessionId = runtimeState.members.find((member) => member.name === "member-a")?.sessionId

    // when
    const result = parseToolResult<{ deleted: boolean }>(await deleteTool.execute(
      { teamRunId: created.teamRunId, force: true },
      createToolContext(memberSessionId ?? "member-a-session"),
    ))

    // then
    expect(result.deleted).toBe(true)
    expect(hasRuntime(created.teamRunId)).toBe(false)
  })

  test("team_delete still rejects non-participants even with force=true", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const deleteTool = createTeamDeleteTool(config, mockClient, backgroundManager, undefined, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string }>(await createTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))
    requireRuntime(created.teamRunId).status = "orphaned"

    // when
    const result = deleteTool.execute({ teamRunId: created.teamRunId, force: true }, createToolContext("outside-session"))

    // then
    expect(result).rejects.toThrow("team_delete is lead-only")
  })

  test("team_delete force=true allows member participant to recover a stuck deleting team", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const deleteTool = createTeamDeleteTool(config, mockClient, backgroundManager, undefined, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string }>(await createTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))
    const runtimeState = requireRuntime(created.teamRunId)
    runtimeState.status = "deleting"
    const memberSessionId = runtimeState.members.find((member) => member.name === "member-a")?.sessionId

    // when
    const result = parseToolResult<{ deleted: boolean }>(await deleteTool.execute({ teamRunId: created.teamRunId, force: true }, createToolContext(memberSessionId ?? "member-a-session")))

    // then
    expect(result.deleted).toBe(true)
    expect(hasRuntime(created.teamRunId)).toBe(false)
  })

  test("team_delete force=false on orphaned team still requires lead", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const deleteTool = createTeamDeleteTool(config, mockClient, backgroundManager, undefined, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string }>(await createTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))
    const runtimeState = requireRuntime(created.teamRunId)
    runtimeState.status = "orphaned"
    const memberSessionId = runtimeState.members.find((member) => member.name === "member-a")?.sessionId

    // when
    const result = deleteTool.execute({ teamRunId: created.teamRunId }, createToolContext(memberSessionId ?? "member-a-session"))

    // then
    expect(result).rejects.toThrow("team_delete is lead-only")
  })

  test("team_create is idempotent for the same spec and lead session", async () => {
    // given
    const teamCreateTool = createTeamCreateToolForTest()

    // when
    const firstResult = parseToolResult<{ teamRunId: string }>(await teamCreateTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))
    const secondResult = parseToolResult<{ teamRunId: string }>(await teamCreateTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))

    // then
    expect(firstResult.teamRunId).toBe(secondResult.teamRunId)
    expect(createTeamRunMock).toHaveBeenCalledTimes(2)
  })

  test("runs full lifecycle through create, request, approve, and delete", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const requestTool = createTeamShutdownRequestTool(config, mockClient, lifecycleDeps)
    const approveTool = createTeamApproveShutdownTool(config, mockClient, lifecycleDeps)
    const deleteTool = createTeamDeleteTool(config, mockClient, backgroundManager, undefined, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string; runtimeState: RuntimeState }>(await createTool.execute({ inline_spec: createSpec() }, createToolContext("lead-session")))
    const memberSessionId = created.runtimeState.members.find((member) => member.name === "member-a")?.sessionId

    // when
    const requestResult = parseToolResult<{ status: string }>(await requestTool.execute({ teamRunId: created.teamRunId, targetMemberName: "member-a" }, createToolContext("lead-session")))
    const approveResult = parseToolResult<{ status: string }>(await approveTool.execute({ teamRunId: created.teamRunId, memberName: "member-a" }, createToolContext(memberSessionId ?? "member-a-session")))
    const deleteResult = parseToolResult<{ deleted: boolean }>(await deleteTool.execute({ teamRunId: created.teamRunId }, createToolContext("lead-session")))

    // then
    expect(requestResult.status).toBe("shutdown_requested")
    expect(approveResult.status).toBe("shutdown_approved")
    expect(deleteResult.deleted).toBe(true)
    expect(hasRuntime(created.teamRunId)).toBe(false)
  })

  test("team_reject_shutdown records the rejection reason", async () => {
    // given
    const createTool = createTeamCreateToolForTest()
    const requestTool = createTeamShutdownRequestTool(config, mockClient, lifecycleDeps)
    const rejectTool = createTeamRejectShutdownTool(config, mockClient, lifecycleDeps)
    const created = parseToolResult<{ teamRunId: string; runtimeState: RuntimeState }>(await createTool.execute({ teamName: "alpha-team" }, createToolContext("lead-session")))
    const memberSessionId = created.runtimeState.members.find((member) => member.name === "member-a")?.sessionId
    await requestTool.execute({ teamRunId: created.teamRunId, targetMemberName: "member-a" }, createToolContext("lead-session"))

    // when
    const result = parseToolResult<{ teamRunId: string; memberName: string; rejectedBy: string; reason: string; status: string }>(await rejectTool.execute({ teamRunId: created.teamRunId, memberName: "member-a", reason: "still working" }, createToolContext(memberSessionId ?? "member-a-session")))

    // then
    expect(result).toEqual({ teamRunId: created.teamRunId, memberName: "member-a", rejectedBy: "member-a", reason: "still working", status: "shutdown_rejected" })
    expect(getLatestShutdownRequest(requireRuntime(created.teamRunId), "member-a")).toEqual(expect.objectContaining({ rejectedReason: "still working", rejectedAt: expect.any(Number) }))
  })
})
