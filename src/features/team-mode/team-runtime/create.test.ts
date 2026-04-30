/// <reference types="bun-types" />

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import { access, mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { BackgroundTask, LaunchInput } from "../../background-agent/types"
import { BackgroundManager } from "../../background-agent/manager"
import { loadRuntimeState } from "../team-state-store/store"
import type { TeamSpec } from "../types"

const resolveMemberMock = mock(async (member: TeamSpec["members"][number]) => ({
  agentToUse: `${member.name}-agent`,
  model: { providerID: "openai", modelID: "gpt-5.4-mini" },
  fallbackChain: undefined,
  systemContent: `system:${member.name}`,
}))

mock.module("./resolve-member", () => ({ resolveMember: resolveMemberMock }))

const { createTeamRun, TeamRunCreateError } = await import("./create")

function createConfig(baseDir: string, maxParallelMembers = 4) {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, max_parallel_members: maxParallelMembers, max_wall_clock_minutes: 1 })
}

function createSpec(memberCount: number, withWorktrees = false): TeamSpec {
  return {
    version: 1,
    name: "alpha-team",
    createdAt: Date.now(),
    leadAgentId: "member-1",
    members: Array.from({ length: memberCount }, (_, index) => ({
      kind: "category",
      name: `member-${index + 1}`,
      category: ["quick", "deep", "artistry"][index] ?? "deep",
      prompt: `prompt-${index + 1}`,
      backendType: "in-process",
      isActive: true,
      color: `color-${index + 1}`,
      ...(withWorktrees ? { worktreePath: `./worktrees/member-${index + 1}` } : {}),
    })),
  }
}

function createContext(baseDir: string, manager: BackgroundManager): ExecutorContext & { client: { session: { create: ReturnType<typeof mock> } } } {
  return {
    client: { session: { create: mock(async () => ({ data: { id: "forbidden" } })) } } as ExecutorContext["client"] & { session: { create: ReturnType<typeof mock> } },
    manager,
    directory: baseDir,
  }
}

function createManager(
  baseDir: string,
  launchImpl: (input: LaunchInput) => Promise<BackgroundTask>,
  getTaskImpl: (taskId: string) => BackgroundTask | undefined = () => undefined,
): { manager: BackgroundManager; launchMock: ReturnType<typeof mock>; cancelTaskMock: ReturnType<typeof mock> } {
  const manager = new BackgroundManager({ client: {} as ExecutorContext["client"], directory: baseDir } as ConstructorParameters<typeof BackgroundManager>[0])
  const launchMock = mock((input: LaunchInput) => launchImpl(input))
  const getTaskMock = mock((taskId: string) => getTaskImpl(taskId))
  const cancelTaskMock = mock(async () => true)
  manager.launch = launchMock
  manager.getTask = getTaskMock
  manager.cancelTask = cancelTaskMock
  return { manager, launchMock, cancelTaskMock }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function loadSingleRuntimeState(baseDir: string) {
  const [teamRunId] = await readdir(path.join(baseDir, "runtime"))
  return await loadRuntimeState(teamRunId ?? "", createConfig(baseDir))
}

describe("createTeamRun", () => {
  const temporaryDirectories: string[] = []

  beforeEach(() => {
    resolveMemberMock.mockClear()
  })

  afterAll(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => rm(directoryPath, { recursive: true, force: true })))
  })

  test("spawns 3 members through BackgroundManager.launch without direct session creation", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-create-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async () => ({ id: `task-${++launchCount}`, sessionID: `session-${launchCount}`, status: "running" } as BackgroundTask))
    const context = createContext(baseDir, manager)

    // when
    const runtimeState = await createTeamRun(createSpec(3), "lead-session", context, createConfig(baseDir), manager)

    // then
    expect(launchMock).toHaveBeenCalledTimes(3)
    expect(context.client.session.create).toHaveBeenCalledTimes(0)
    expect(runtimeState.status).toBe("active")
    expect(runtimeState.members.map((member) => member.sessionId)).toEqual(["session-1", "session-2", "session-3"])
    expect((launchMock.mock.calls as Array<[LaunchInput]>).every(([input]) => input.suppressTmuxSpawn === true)).toBe(true)
  })

  test("persists the resolved subagent_type and model on each spawned runtime member", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-subagent-type-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager } = createManager(baseDir, async () => ({ id: `task-${++launchCount}`, sessionID: `session-${launchCount}`, status: "running" } as BackgroundTask))

    // when
    const runtimeState = await createTeamRun(createSpec(3), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)

    // then
    expect(runtimeState.members.map((member) => ({
      name: member.name,
      subagent_type: member.subagent_type,
      model: member.model,
    }))).toEqual([
      { name: "member-1", subagent_type: "member-1-agent", model: { providerID: "openai", modelID: "gpt-5.4-mini" } },
      { name: "member-2", subagent_type: "member-2-agent", model: { providerID: "openai", modelID: "gpt-5.4-mini" } },
      { name: "member-3", subagent_type: "member-3-agent", model: { providerID: "openai", modelID: "gpt-5.4-mini" } },
    ])
  })

  test("member prompt only documents member-safe communication tools", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-member-prompt-"))
    temporaryDirectories.push(baseDir)
    const { manager, launchMock } = createManager(baseDir, async () => ({
      id: "task-1",
      sessionID: "session-1",
      status: "running",
    } as BackgroundTask))

    // when
    await createTeamRun(createSpec(1), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)
    const firstPrompt = (launchMock.mock.calls as Array<[LaunchInput]>)[0]?.[0].prompt ?? ""

    // then
    expect(firstPrompt).toContain("Lead-only tools you must NOT call")
    expect(firstPrompt).not.toContain("3. Request shutdown via `team_shutdown_request`")
    expect(firstPrompt).toContain("Include `summary` and `references`")
    expect(firstPrompt).toContain("Move to `status: \"in_progress\"` when you start working")
    expect(firstPrompt).toContain("Do NOT call this from inside team members")
    expect(firstPrompt).toContain("lead can decide whether to request shutdown")
    expect(firstPrompt).toContain("user interacts primarily with the team lead")
    expect(firstPrompt).toContain("Idle is normal")
    expect(firstPrompt).toContain("structured JSON status messages")
  })

  test("rolls back launched members in reverse order when a later spawn fails", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-rollback-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, cancelTaskMock } = createManager(baseDir, async () => {
      launchCount += 1
      if (launchCount === 4) throw new Error("launch-4 failed")
      return { id: `task-${launchCount}`, sessionID: `session-${launchCount}`, status: "running" } as BackgroundTask
    })

    // when
    const result = createTeamRun(createSpec(4), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)

    // then
    try {
      await result
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(TeamRunCreateError)
    }
    expect((cancelTaskMock.mock.calls as Array<[string]>).map(([taskId]) => taskId)).toEqual(["task-3", "task-2", "task-1"])
    expect((await loadSingleRuntimeState(baseDir)).status).toBe("failed")
  })

  test("removes all created worktrees when spawn fails after worktree creation", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-worktree-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager } = createManager(baseDir, async () => {
      launchCount += 1
      if (launchCount === 2) throw new Error("launch-2 failed")
      return { id: `task-${launchCount}`, sessionID: `session-${launchCount}`, status: "running" } as BackgroundTask
    })
    const spec = createSpec(2, true)

    // when
    try {
      await createTeamRun(spec, "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      expect(error).toBeInstanceOf(TeamRunCreateError)
    }

    // then
    expect(await pathExists(path.resolve(baseDir, "./worktrees/member-1"))).toBe(false)
    expect(await pathExists(path.resolve(baseDir, "./worktrees/member-2"))).toBe(false)
  })

  test("returns the existing runtime on repeated calls with the same spec and lead session", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-idempotent-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async () => ({ id: `task-${++launchCount}`, sessionID: `session-${launchCount}`, status: "running" } as BackgroundTask))
    const spec = createSpec(2)
    const context = createContext(baseDir, manager)

    // when
    const firstRuntime = await createTeamRun(spec, "lead-session", context, createConfig(baseDir), manager)
    const secondRuntime = await createTeamRun(spec, "lead-session", context, createConfig(baseDir), manager)

    // then
    expect(firstRuntime.teamRunId).toBe(secondRuntime.teamRunId)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  test("never exceeds max_parallel_members while spawning", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-parallel-"))
    temporaryDirectories.push(baseDir)
    let inFlight = 0
    let maxInFlight = 0
    let launchCount = 0
    const { manager } = createManager(baseDir, async () => {
      launchCount += 1
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
      return { id: `task-${launchCount}`, sessionID: `session-${launchCount}`, status: "running" } as BackgroundTask
    })

    // when
    await createTeamRun(createSpec(8), "lead-session", createContext(baseDir, manager), createConfig(baseDir, 4), manager)

    // then
    expect(maxInFlight).toBeLessThanOrEqual(4)
  })

  test("reuses the caller session for the lead when the lead matches the caller agent", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-caller-lead-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async (input) => ({
      id: `task-${++launchCount}`,
      sessionID: `${input.agent}-session-${launchCount}`,
      status: "running",
    } as BackgroundTask))
    const spec: TeamSpec = {
      version: 1,
      name: "alpha-team",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true },
        { kind: "category", name: "member-1", category: "quick", prompt: "prompt-1", backendType: "in-process", isActive: true },
      ],
    }

    // when
    const runtimeState = await createTeamRun(
      spec,
      "lead-session",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
      undefined,
      { callerAgentTypeId: "sisyphus" },
    )

    // then
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(launchMock.mock.calls[0]?.[0]).toMatchObject({ description: "Create team member alpha-team/member-1" })
    expect(resolveMemberMock).toHaveBeenCalledTimes(1)
    expect(resolveMemberMock.mock.calls[0]?.[0]).toMatchObject({ name: "member-1" })
    expect(runtimeState.members.map((member) => ({ name: member.name, sessionId: member.sessionId }))).toEqual([
      { name: "lead", sessionId: "lead-session" },
      { name: "member-1", sessionId: "member-1-agent-session-1" },
    ])
  })

  test("persists the reused caller lead's subagent_type so live deliveries can pin it", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-caller-lead-pin-"))
    temporaryDirectories.push(baseDir)
    const { manager } = createManager(baseDir, async (input) => ({
      id: `task-${input.agent}`,
      sessionID: `${input.agent}-session`,
      status: "running",
    } as BackgroundTask))
    const spec: TeamSpec = {
      version: 1,
      name: "alpha-team",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true },
        { kind: "category", name: "worker", category: "quick", prompt: "work hard", backendType: "in-process", isActive: true },
      ],
    }

    // when
    const runtimeState = await createTeamRun(
      spec,
      "ses_caller_sisyphus",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
      undefined,
      { callerAgentTypeId: "sisyphus" },
    )

    // then
    const leadMember = runtimeState.members.find((member) => member.name === "lead")
    expect(leadMember?.sessionId).toBe("ses_caller_sisyphus")
    expect(leadMember?.subagent_type).toBe("sisyphus")
    expect(leadMember?.model).toBeUndefined()
  })

  test("reuses the caller session for the lead even when the lead subagent_type differs", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-explicit-lead-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async (input) => ({
      id: `task-${++launchCount}`,
      sessionID: `${input.agent}-session-${launchCount}`,
      status: "running",
    } as BackgroundTask))
    const spec: TeamSpec = {
      version: 1,
      name: "alpha-team",
      createdAt: Date.now(),
      leadAgentId: "captain",
      members: [
        { kind: "subagent_type", name: "captain", subagent_type: "atlas", backendType: "in-process", isActive: true },
        { kind: "category", name: "member-1", category: "quick", prompt: "prompt-1", backendType: "in-process", isActive: true },
      ],
    }

    // when
    const runtimeState = await createTeamRun(
      spec,
      "lead-session",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
      undefined,
      { callerAgentTypeId: "sisyphus" },
    )

    // then
    expect(launchMock).toHaveBeenCalledTimes(1)
    expect(launchMock.mock.calls.map(([input]) => input.description)).toEqual([
      "Create team member alpha-team/member-1",
    ])
    expect(runtimeState.members.map((member) => ({ name: member.name, sessionId: member.sessionId }))).toEqual([
      { name: "captain", sessionId: "lead-session" },
      { name: "member-1", sessionId: "member-1-agent-session-1" },
    ])
  })
})
