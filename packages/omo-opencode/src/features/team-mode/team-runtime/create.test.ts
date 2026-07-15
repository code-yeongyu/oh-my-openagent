/// <reference types="bun-types" />

// allow: SIZE_OK - team runtime creation tests share filesystem and tmux mock state; this release adds small lock/spawn coverage and future edits should split by runtime phase.

import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { BackgroundTask, LaunchInput } from "../../background-agent/types"
import { BackgroundManager } from "../../background-agent/manager"
import { getInboxDir } from "../team-registry/paths"
import { loadRuntimeState, transitionRuntimeState } from "../team-state-store/store"
import { clearTeamSessionRegistry, lookupTeamSession } from "../team-session-registry"
import type { TeamSpec } from "../types"
import type { ResolvedMember, ResolveMemberOptions } from "./resolve-member"
import {
  clearSessionTeamRunCleanupRegistry,
  getSessionCreatedTeamRunIds,
} from "./session-cleanup"
import { createLaunchConcurrencyProbe } from "../test-support/async-test-helpers"

type ResolveMember = (
  member: TeamSpec["members"][number],
  context: ExecutorContext,
  options: ResolveMemberOptions,
) => Promise<ResolvedMember>

const createResolvedMember: ResolveMember = async (member) => ({
  memberName: member.name,
  agentToUse: `${member.name}-agent`,
  model: { providerID: "openai", modelID: "gpt-5.4-mini" },
  fallbackChain: undefined,
  systemContent: `system:${member.name}`,
})
const resolveMemberMock = mock<ResolveMember>(createResolvedMember)

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

function setMemberWorktree(spec: TeamSpec, memberIndex: number, worktreePath: string): void {
  const member = spec.members[memberIndex]
  if (!member) throw new Error(`missing member at index ${memberIndex}`)
  spec.members[memberIndex] = { ...member, worktreePath }
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
  const manager = new BackgroundManager({ pluginContext: { client: {} as ExecutorContext["client"], directory: baseDir } as PluginInput })
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
    resolveMemberMock.mockReset()
    resolveMemberMock.mockImplementation(createResolvedMember)
    clearTeamSessionRegistry()
    clearSessionTeamRunCleanupRegistry()
  })

  afterEach(() => {
    clearSessionTeamRunCleanupRegistry()
  })

  afterAll(async () => {
    clearSessionTeamRunCleanupRegistry()
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => rm(directoryPath, { recursive: true, force: true })))
  })

  test("spawns 3 members through BackgroundManager.launch without direct session creation", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-create-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async () => ({ id: `task-${++launchCount}`, sessionId: `session-${launchCount}`, status: "running" } as BackgroundTask))
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

  test("resolves every member before launching any child and leaves no runtime or worktree residue when preflight fails", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-preflight-"))
    temporaryDirectories.push(baseDir)
    const { manager, launchMock } = createManager(baseDir, async () => ({
      id: "unexpected-task",
      sessionId: "unexpected-session",
      status: "running",
    } as BackgroundTask))
    resolveMemberMock.mockImplementation(async (member: TeamSpec["members"][number]) => {
      if (member.name === "member-2") {
        throw new Error("member registry validation failed")
      }
      return createResolvedMember(member)
    })

    // when
    const result = createTeamRun(
      createSpec(2, true),
      "lead-session",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
    )

    // then
    await expect(result).rejects.toThrow("member registry validation failed")
    expect(resolveMemberMock).toHaveBeenCalledTimes(2)
    expect(launchMock).not.toHaveBeenCalled()
    expect(await readdir(path.join(baseDir, "worktrees"))).toEqual([])
    expect(await readdir(path.join(baseDir, "runtime"))).toEqual([])
  })

  test("#given a new team runtime #when createTeamRun succeeds #then it registers the run for session cleanup", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-session-cleanup-"))
    temporaryDirectories.push(baseDir)
    const { manager } = createManager(baseDir, async () => ({ id: "task-1", sessionId: "session-1", status: "running" } as BackgroundTask))

    // when
    const runtimeState = await createTeamRun(createSpec(1), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)

    // then
    expect(getSessionCreatedTeamRunIds()).toEqual([runtimeState.teamRunId])
  })

  test("registers a member session as soon as launch reports the real sessionId", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-session-lineage-"))
    temporaryDirectories.push(baseDir)
    const tasks = new Map<string, BackgroundTask>()
    const { manager } = createManager(
      baseDir,
      async (input) => {
        const task = {
          id: "task-lineage",
          status: "pending",
          parentSessionId: input.parentSessionId,
          parentMessageId: input.parentMessageId,
          description: input.description,
          prompt: input.prompt,
          agent: input.agent,
        } satisfies BackgroundTask
        tasks.set(task.id, task)
        input.onSessionCreated?.("session-lineage")
        tasks.set(task.id, { ...task, sessionId: "session-lineage", status: "running" })
        expect(lookupTeamSession("session-lineage")).toEqual({
          teamRunId: expect.any(String),
          memberName: "member-1",
          role: "lead",
        })
        return task
      },
      (taskId) => tasks.get(taskId),
    )

    // when
    const runtimeState = await createTeamRun(createSpec(1), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)

    // then
    expect(runtimeState.members[0]?.sessionId).toBe("session-lineage")
    expect(lookupTeamSession("session-lineage")).toEqual({
      teamRunId: runtimeState.teamRunId,
      memberName: "member-1",
      role: "lead",
    })
  })

  test("persists the resolved subagent_type and model on each spawned runtime member", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-subagent-type-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager } = createManager(baseDir, async () => ({ id: `task-${++launchCount}`, sessionId: `session-${launchCount}`, status: "running" } as BackgroundTask))

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
      sessionId: "session-1",
      status: "running",
    } as BackgroundTask))

    // when
    await createTeamRun(createSpec(1), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)
    const firstPrompt = (launchMock.mock.calls as Array<[LaunchInput]>)[0]?.[0].prompt ?? ""

    // then
    expect(firstPrompt).toContain("Lead-only tools you must NOT call")
    expect(firstPrompt).not.toContain("3. Request shutdown via `team_shutdown_request`")
  })

  test("rolls back launched members in reverse order when a later spawn fails", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-rollback-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, cancelTaskMock } = createManager(baseDir, async () => {
      launchCount += 1
      if (launchCount === 4) throw new Error("launch-4 failed")
      return { id: `task-${launchCount}`, sessionId: `session-${launchCount}`, status: "running" } as BackgroundTask
    })

    // when
    const result = createTeamRun(createSpec(4), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)

    // then
    try {
      await result
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      if (!(error instanceof TeamRunCreateError)) throw error
      expect(error).toBeInstanceOf(TeamRunCreateError)
    }
    expect((cancelTaskMock.mock.calls as Array<[string]>).map(([taskId]) => taskId)).toEqual(["task-3", "task-2", "task-1"])
    expect((await loadSingleRuntimeState(baseDir)).status).toBe("failed")
    expect(getSessionCreatedTeamRunIds()).toEqual([])
  })

  test("#given member launch throws a non-Error value #when createTeamRun rolls back #then it preserves the fallback error message", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-non-error-"))
    temporaryDirectories.push(baseDir)
    const { manager } = createManager(baseDir, async () => Promise.reject("launch failed as string"))

    // when
    const result = createTeamRun(createSpec(1), "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)

    // then
    try {
      await result
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      if (!(error instanceof TeamRunCreateError)) throw error
      expect(error).toBeInstanceOf(TeamRunCreateError)
      expect(error).toHaveProperty("message", "Failed to create team run 'alpha-team': launch failed as string")
    }
  })

  test("removes all created worktrees when spawn fails after worktree creation", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-worktree-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager } = createManager(baseDir, async () => {
      launchCount += 1
      if (launchCount === 2) throw new Error("launch-2 failed")
      return { id: `task-${launchCount}`, sessionId: `session-${launchCount}`, status: "running" } as BackgroundTask
    })
    const spec = createSpec(2, true)

    // when
    try {
      await createTeamRun(spec, "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      if (!(error instanceof TeamRunCreateError)) throw error
      expect(error).toBeInstanceOf(TeamRunCreateError)
    }

    // then
    expect(await pathExists(path.resolve(baseDir, "./worktrees/member-1"))).toBe(false)
    expect(await pathExists(path.resolve(baseDir, "./worktrees/member-2"))).toBe(false)
  })

  test("preserves a pre-existing worktree and removes only the owned root when runtime state creation fails", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-state-failure-"))
    temporaryDirectories.push(baseDir)
    const { manager, launchMock } = createManager(baseDir, async () => ({
      id: "unexpected-task",
      sessionId: "unexpected-session",
      status: "running",
    } as BackgroundTask))
    const spec = createSpec(2, true)
    const existingWorktree = path.join(baseDir, "existing-worktree")
    const sentinelPath = path.join(existingWorktree, "sentinel.txt")
    await mkdir(existingWorktree, { recursive: true })
    await writeFile(sentinelPath, "keep-runtime-state")
    setMemberWorktree(spec, 0, existingWorktree)
    const ownedWorktreeRoot = path.resolve(baseDir, "./worktrees/member-2")

    // when
    const result = createTeamRun(
      spec,
      "lead-session",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
      undefined,
      undefined,
      { createRuntimeState: async () => { throw new Error("runtime state failed") } },
    )

    // then
    try {
      await result
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      if (!(error instanceof TeamRunCreateError)) throw error
      expect(error.message).toContain("runtime state failed")
      expect(error.cleanupReport.removedWorktrees).toEqual([ownedWorktreeRoot])
    }
    expect(launchMock).not.toHaveBeenCalled()
    expect(await readFile(sentinelPath, "utf8")).toBe("keep-runtime-state")
    expect(await pathExists(ownedWorktreeRoot)).toBe(false)
    expect(await readdir(path.join(baseDir, "worktrees"))).toEqual([])
    expect(await readdir(path.join(baseDir, "runtime"))).toEqual([])
    expect(getSessionCreatedTeamRunIds()).toEqual([])
  })

  test("preserves a pre-existing worktree and removes only the owned root when inbox creation fails", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-inbox-failure-"))
    temporaryDirectories.push(baseDir)
    const { manager, launchMock } = createManager(baseDir, async () => ({
      id: "unexpected-task",
      sessionId: "unexpected-session",
      status: "running",
    } as BackgroundTask))
    const spec = createSpec(2, true)
    const existingWorktree = path.join(baseDir, "existing-worktree")
    const sentinelPath = path.join(existingWorktree, "sentinel.txt")
    await mkdir(existingWorktree, { recursive: true })
    await writeFile(sentinelPath, "keep-inbox")
    spec.members[0] = {
      kind: "subagent_type",
      name: "member-1",
      subagent_type: "sisyphus",
      backendType: "in-process",
      isActive: true,
      worktreePath: existingWorktree,
    }
    const ownedWorktreeRoot = path.resolve(baseDir, "./worktrees/member-2")
    const attemptedInboxes: string[] = []
    let metadataBeforeInbox: Array<{
      name: string
      worktreePath: string | undefined
      ownedWorktreeRoot: string | undefined
    }> | undefined

    // when
    const result = createTeamRun(
      spec,
      "lead-session",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
      undefined,
      { callerAgentTypeId: "sisyphus" },
      {
        createInbox: async (inboxDir) => {
          if (attemptedInboxes.length === 0) {
            const persistedState = await loadSingleRuntimeState(baseDir)
            metadataBeforeInbox = persistedState.members.map((member) => ({
              name: member.name,
              worktreePath: member.worktreePath,
              ownedWorktreeRoot: member.ownedWorktreeRoot,
            }))
          }
          attemptedInboxes.push(inboxDir)
          await mkdir(inboxDir, { recursive: true })
          if (attemptedInboxes.length === 2) throw new Error("inbox creation failed")
        },
      },
    )

    // then
    try {
      await result
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      if (!(error instanceof TeamRunCreateError)) throw error
      expect(error.message).toContain("inbox creation failed")
      expect(error.cleanupReport.removedWorktrees).toEqual([ownedWorktreeRoot])
    }
    const runtimeState = await loadSingleRuntimeState(baseDir)
    const expectedMetadata = [
      { name: "member-1", worktreePath: existingWorktree, ownedWorktreeRoot: undefined },
      { name: "member-2", worktreePath: ownedWorktreeRoot, ownedWorktreeRoot },
    ]
    expect(runtimeState.status).toBe("failed")
    expect(metadataBeforeInbox).toEqual(expectedMetadata)
    expect(runtimeState.members.map((member) => ({
      name: member.name,
      worktreePath: member.worktreePath,
      ownedWorktreeRoot: member.ownedWorktreeRoot,
    }))).toEqual(expectedMetadata)
    expect(lookupTeamSession("lead-session")).toBeUndefined()
    expect(getSessionCreatedTeamRunIds()).toEqual([])
    expect(launchMock).not.toHaveBeenCalled()
    expect(await readFile(sentinelPath, "utf8")).toBe("keep-inbox")
    expect(await pathExists(ownedWorktreeRoot)).toBe(false)
    expect(attemptedInboxes).toEqual([
      getInboxDir(baseDir, runtimeState.teamRunId, "member-1"),
      getInboxDir(baseDir, runtimeState.teamRunId, "member-2"),
    ])
    expect(await Promise.all(attemptedInboxes.map(pathExists))).toEqual([false, false])
  })

  test("removes an overlapping owned worktree root once and reports only that root", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-overlapping-roots-"))
    temporaryDirectories.push(baseDir)
    const { manager } = createManager(baseDir, async () => ({
      id: "unexpected-task",
      sessionId: "unexpected-session",
      status: "running",
    } as BackgroundTask))
    const spec = createSpec(2)
    setMemberWorktree(spec, 0, "./shared/member-1")
    setMemberWorktree(spec, 1, "./shared/member-2")
    const ownedWorktreeRoot = path.resolve(baseDir, "./shared")

    // when
    const result = createTeamRun(
      spec,
      "lead-session",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
      undefined,
      undefined,
      { createRuntimeState: async () => { throw new Error("runtime state failed") } },
    )

    // then
    try {
      await result
      throw new Error("expected createTeamRun to reject")
    } catch (error) {
      if (!(error instanceof TeamRunCreateError)) throw error
      expect(error.cleanupReport.removedWorktrees).toEqual([ownedWorktreeRoot])
    }
    expect(await pathExists(ownedWorktreeRoot)).toBe(false)
  })

  test("launches each member with its exact resolved identity, model, worktree directory, and question denial", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-exact-launch-"))
    temporaryDirectories.push(baseDir)
    const { manager, launchMock } = createManager(baseDir, async () => ({
      id: "task-1",
      sessionId: "session-1",
      status: "running",
    } as BackgroundTask))
    const spec = createSpec(1, true)
    spec.members[0] = {
      kind: "subagent_type",
      name: "member-1",
      subagent_type: "repository-reviewer",
      backendType: "in-process",
      isActive: true,
      worktreePath: "./worktrees/member-1",
    }
    resolveMemberMock.mockResolvedValue({
      memberName: "member-1",
      agentToUse: "repository-reviewer",
      exactAgent: true,
      model: { providerID: "openai", modelID: "gpt-5.6-sol", variant: "xhigh" },
      fallbackChain: undefined,
      systemContent: undefined,
    })

    // when
    await createTeamRun(spec, "lead-session", createContext(baseDir, manager), createConfig(baseDir), manager)

    // then
    const launchInput = (launchMock.mock.calls as Array<[LaunchInput]>)[0]?.[0]
    expect(launchInput).toMatchObject({
      agent: "repository-reviewer",
      directory: path.resolve(baseDir, "./worktrees/member-1"),
      exactAgent: true,
      model: { providerID: "openai", modelID: "gpt-5.6-sol", variant: "xhigh" },
      skillContent: undefined,
      sessionPermission: [{ permission: "question", action: "deny", pattern: "*" }],
    })
    expect(resolveMemberMock.mock.calls[0]?.[2]).toMatchObject({
      directory: path.resolve(baseDir, "./worktrees/member-1"),
      isLead: true,
    })
  })

  test("does not reuse a built-in caller session when the declared lead is a project agent", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-project-lead-"))
    temporaryDirectories.push(baseDir)
    const { manager, launchMock } = createManager(baseDir, async () => ({
      id: "unexpected-task",
      sessionId: "unexpected-session",
      status: "running",
    } as BackgroundTask))
    const spec = createSpec(1)
    spec.members[0] = {
      kind: "subagent_type",
      name: "member-1",
      subagent_type: "repository-reviewer",
      backendType: "in-process",
      isActive: true,
    }
    resolveMemberMock.mockRejectedValue(new Error("project agents are member-only"))

    // when
    const result = createTeamRun(
      spec,
      "lead-session",
      createContext(baseDir, manager),
      createConfig(baseDir),
      manager,
      undefined,
      { callerAgentTypeId: "sisyphus" },
    )

    // then
    await expect(result).rejects.toThrow("project agents are member-only")
    expect(resolveMemberMock.mock.calls[0]?.[2]).toMatchObject({ isLead: true })
    expect(launchMock).not.toHaveBeenCalled()
  })

  test("returns the existing runtime on repeated calls with the same spec and lead session", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-idempotent-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async () => ({ id: `task-${++launchCount}`, sessionId: `session-${launchCount}`, status: "running" } as BackgroundTask))
    const spec = createSpec(2)
    const context = createContext(baseDir, manager)

    // when
    const firstRuntime = await createTeamRun(spec, "lead-session", context, createConfig(baseDir), manager)
    const secondRuntime = await createTeamRun(spec, "lead-session", context, createConfig(baseDir), manager)

    // then
    expect(firstRuntime.teamRunId).toBe(secondRuntime.teamRunId)
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  test("#given an existing active runtime with unresolved members #when createTeamRun runs again #then it creates a fresh runtime", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-unresolved-existing-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async () => ({ id: `task-${++launchCount}`, sessionId: `session-${launchCount}`, status: "running" } as BackgroundTask))
    const spec = createSpec(1)
    const context = createContext(baseDir, manager)
    const config = createConfig(baseDir)
    const firstRuntime = await createTeamRun(spec, "lead-session", context, config, manager)
    await transitionRuntimeState(firstRuntime.teamRunId, (currentState) => ({
      ...currentState,
      members: currentState.members.map((member) => ({ ...member, sessionId: undefined, status: "pending" })),
    }), config)

    // when
    const secondRuntime = await createTeamRun(spec, "lead-session", context, config, manager)

    // then
    expect(secondRuntime.teamRunId).not.toBe(firstRuntime.teamRunId)
    expect(secondRuntime.members[0]?.sessionId).toBe("session-2")
    expect(launchMock).toHaveBeenCalledTimes(2)
  })

  test("never exceeds max_parallel_members while spawning", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-parallel-"))
    temporaryDirectories.push(baseDir)
    const launchLimit = 4
    const launchProbe = createLaunchConcurrencyProbe({
      launchLimit,
      sessionIdPrefix: "session",
      taskIdPrefix: "task",
    })
    const { manager } = createManager(baseDir, async (input) => launchProbe.launch(input))

    // when
    const run = createTeamRun(createSpec(8), "lead-session", createContext(baseDir, manager), createConfig(baseDir, launchLimit), manager)
    try {
      const firstBatch = await launchProbe.waitForFirstBatch()
      await launchProbe.releaseAndWaitForCompletion(run)
      const completed = launchProbe.snapshot()

      // then
      expect(firstBatch.launchCount).toBe(launchLimit)
      expect(firstBatch.inFlight).toBe(launchLimit)
      expect(firstBatch.maxInFlight).toBe(launchLimit)
      expect(completed.launchCount).toBe(8)
      expect(completed.maxInFlight).toBeLessThanOrEqual(launchLimit)
    } finally {
      launchProbe.release()
      run.catch(() => undefined)
    }
  }, 30000)

  test("reuses the caller session for the lead when the lead matches the caller agent", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-runtime-caller-lead-"))
    temporaryDirectories.push(baseDir)
    let launchCount = 0
    const { manager, launchMock } = createManager(baseDir, async (input) => ({
      id: `task-${++launchCount}`,
      sessionId: `${input.agent}-session-${launchCount}`,
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
      sessionId: `${input.agent}-session`,
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
      sessionId: `${input.agent}-session-${launchCount}`,
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
