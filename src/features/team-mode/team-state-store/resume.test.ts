/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readdir, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import type { TeamSpec } from "../types"
import { resumeAllTeams } from "./resume"
import { createRuntimeState, loadRuntimeState, saveRuntimeState, transitionRuntimeState } from "./store"

async function createTemporaryBaseDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mode-resume-"))
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({
    base_dir: baseDir,
    max_members: 6,
    max_parallel_members: 3,
    max_messages_per_run: 200,
    max_wall_clock_minutes: 45,
    max_member_turns: 50,
  })
}

function createSpec(name = `team-${randomUUID().slice(0, 8)}`): TeamSpec {
  return {
    version: 1,
    name,
    createdAt: Date.now(),
    leadAgentId: "lead",
    members: [
      {
        kind: "subagent_type",
        name: "lead",
        subagent_type: "sisyphus",
        backendType: "in-process",
        isActive: true,
        color: "red",
      },
      {
        kind: "category",
        name: "worker",
        category: "deep",
        prompt: "implement task",
        backendType: "in-process",
        isActive: true,
        color: "blue",
      },
    ],
  }
}

function createSpecWithTwoWorkers(name = `team-${randomUUID().slice(0, 8)}`): TeamSpec {
  return {
    version: 1,
    name,
    createdAt: Date.now(),
    leadAgentId: "lead",
    members: [
      {
        kind: "subagent_type",
        name: "lead",
        subagent_type: "sisyphus",
        backendType: "in-process",
        isActive: true,
        color: "red",
      },
      {
        kind: "category",
        name: "worker-a",
        category: "deep",
        prompt: "implement task",
        backendType: "in-process",
        isActive: true,
        color: "blue",
      },
      {
        kind: "category",
        name: "worker-b",
        category: "deep",
        prompt: "implement task",
        backendType: "in-process",
        isActive: true,
        color: "green",
      },
    ],
  }
}

type SessionGetMock = (input: { path: { id: string } }) => Promise<unknown>

function createExecutorContext(
  directory: string,
  sessionGet: SessionGetMock = mock(async () => ({ data: null })),
): ExecutorContext {
  return {
    client: {
      session: {
        get: sessionGet,
      },
    } as ExecutorContext["client"],
    manager: {} as ExecutorContext["manager"],
    directory,
  }
}

describe("resumeAllTeams", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
    mock.restore()
  })

  test("marks stuck creating teams failed after reload recovery", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), "ses_lead", "user", config)
    const worktreePath = path.join(baseDir, "worktrees", runtimeState.teamRunId, "worker")
    await mkdir(worktreePath, { recursive: true })
    await saveRuntimeState({
      ...runtimeState,
      createdAt: Date.now() - 40 * 60 * 1000,
      members: runtimeState.members.map((member) => member.name === "worker"
        ? { ...member, worktreePath }
        : member),
    }, config)

    // when
    const report = await resumeAllTeams(createExecutorContext(baseDir), config)
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(persistedState.status).toBe("failed")
    expect(report).toEqual({
      resumed: 0,
      marked_failed: 1,
      marked_orphaned: 0,
      cleaned: 0,
      errors: [],
    })
    let statError: NodeJS.ErrnoException | null = null
    try {
      await stat(worktreePath)
    } catch (error) {
      statError = error as NodeJS.ErrnoException
    }
    expect(statError?.code).toBe("ENOENT")
  })

  test("marks active teams orphaned when lead session no longer exists", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), "ses_dead", "project", config)
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "active",
    }), config)
    const sessionGet = mock(async () => {
      throw Object.assign(new Error("session not found"), { status: 404 })
    })

    // when
    const report = await resumeAllTeams(createExecutorContext(baseDir, sessionGet), config)
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(sessionGet).toHaveBeenCalledTimes(1)
    expect(persistedState.status).toBe("orphaned")
    expect(report).toEqual({
      resumed: 0,
      marked_failed: 0,
      marked_orphaned: 1,
      cleaned: 0,
      errors: [],
    })
  })

  test("preserves active teams when lead session is still alive", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), "ses_alive", "user", config)
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "active",
    }), config)
    const sessionGet = mock(async () => ({ data: { id: "ses_alive" } }))

    // when
    const report = await resumeAllTeams(createExecutorContext(baseDir, sessionGet), config)
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(sessionGet).toHaveBeenCalledTimes(1)
    expect(persistedState.status).toBe("active")
    expect(report).toEqual({
      resumed: 1,
      marked_failed: 0,
      marked_orphaned: 0,
      cleaned: 0,
      errors: [],
    })
  })

  test("marks dead worker members errored while keeping the team active", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpecWithTwoWorkers(), "ses_alive_lead", "user", config)
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "active",
      leadSessionId: "ses_alive_lead",
      members: currentRuntimeState.members.map((member) => {
        if (member.name === "lead") return { ...member, sessionId: "ses_alive_lead", status: "running" as const }
        if (member.name === "worker-a") return { ...member, sessionId: "ses_dead_a", status: "running" as const }
        if (member.name === "worker-b") return { ...member, sessionId: "ses_alive_b", status: "running" as const }
        return member
      }),
    }), config)
    const sessionGet = mock(async ({ path }: { path: { id: string } }) => {
      if (path.id === "ses_alive_lead" || path.id === "ses_alive_b") return { data: { id: path.id } }
      throw Object.assign(new Error("session not found"), { status: 404 })
    })

    // when
    const report = await resumeAllTeams(createExecutorContext(baseDir, sessionGet), config)
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(persistedState.status).toBe("active")
    const workerA = persistedState.members.find((member) => member.name === "worker-a")
    const workerB = persistedState.members.find((member) => member.name === "worker-b")
    expect(workerA?.status).toBe("errored")
    expect(workerA?.sessionId).toBeUndefined()
    expect(workerB?.status).toBe("running")
    expect(workerB?.sessionId).toBe("ses_alive_b")
    expect(report.resumed).toBe(1)
    expect(report.marked_orphaned).toBe(0)
  })

  test("reclaims stale .delivering-* reservations on resume of an active team", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), "ses_alive", "user", config)
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "active",
    }), config)
    const workerInbox = getInboxDir(resolveBaseDir(config), runtimeState.teamRunId, "worker")
    await mkdir(workerInbox, { recursive: true, mode: 0o700 })
    const strandedMessageId = randomUUID()
    const strandedPath = path.join(workerInbox, `.delivering-${strandedMessageId}.json`)
    await writeFile(strandedPath, JSON.stringify({
      version: 1,
      messageId: strandedMessageId,
      from: "lead",
      to: "worker",
      kind: "message",
      body: "stranded",
      timestamp: Date.now(),
    }))
    const ancientMtime = new Date(Date.now() - 60 * 60 * 1000)
    await utimes(strandedPath, ancientMtime, ancientMtime)
    const sessionGet = mock(async () => ({ data: { id: "ses_alive" } }))

    // when
    await resumeAllTeams(createExecutorContext(baseDir, sessionGet), config)

    // then
    const entries = await readdir(workerInbox)
    expect(entries).toContain(`${strandedMessageId}.json`)
    expect(entries).not.toContain(`.delivering-${strandedMessageId}.json`)
  })

  test("leaves fresh .delivering-* reservations in place on resume", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), "ses_alive", "user", config)
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "active",
    }), config)
    const workerInbox = getInboxDir(resolveBaseDir(config), runtimeState.teamRunId, "worker")
    await mkdir(workerInbox, { recursive: true, mode: 0o700 })
    const freshMessageId = randomUUID()
    const freshPath = path.join(workerInbox, `.delivering-${freshMessageId}.json`)
    await writeFile(freshPath, "{}")
    const sessionGet = mock(async () => ({ data: { id: "ses_alive" } }))

    // when
    await resumeAllTeams(createExecutorContext(baseDir, sessionGet), config)

    // then
    const entries = await readdir(workerInbox)
    expect(entries).toContain(`.delivering-${freshMessageId}.json`)
    expect(entries).not.toContain(`${freshMessageId}.json`)
  })

  test("orphans active teams when every worker session has died", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), "ses_alive_lead", "user", config)
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "active",
      leadSessionId: "ses_alive_lead",
      members: currentRuntimeState.members.map((member) => {
        if (member.name === "lead") return { ...member, sessionId: "ses_alive_lead", status: "running" as const }
        return { ...member, sessionId: "ses_dead_worker", status: "running" as const }
      }),
    }), config)
    const sessionGet = mock(async ({ path }: { path: { id: string } }) => {
      if (path.id === "ses_alive_lead") return { data: { id: path.id } }
      throw Object.assign(new Error("session not found"), { status: 404 })
    })

    // when
    const report = await resumeAllTeams(createExecutorContext(baseDir, sessionGet), config)
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(persistedState.status).toBe("orphaned")
    const worker = persistedState.members.find((member) => member.name === "worker")
    expect(worker?.status).toBe("errored")
    expect(worker?.sessionId).toBeUndefined()
    expect(report.resumed).toBe(0)
    expect(report.marked_orphaned).toBe(1)
  })

  test("orphans active teams on a second resume after one worker was already errored and the last live worker just died", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpecWithTwoWorkers(), "ses_alive_lead", "user", config)
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "active",
      leadSessionId: "ses_alive_lead",
      members: currentRuntimeState.members.map((member) => {
        if (member.name === "lead") return { ...member, sessionId: "ses_alive_lead", status: "running" as const }
        if (member.name === "worker-a") return { ...member, sessionId: undefined, status: "errored" as const }
        return { ...member, sessionId: "ses_dead_b", status: "running" as const }
      }),
    }), config)
    const sessionGet = mock(async ({ path }: { path: { id: string } }) => {
      if (path.id === "ses_alive_lead") return { data: { id: path.id } }
      throw Object.assign(new Error("session not found"), { status: 404 })
    })

    // when
    const report = await resumeAllTeams(createExecutorContext(baseDir, sessionGet), config)
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(persistedState.status).toBe("orphaned")
    const workerA = persistedState.members.find((member) => member.name === "worker-a")
    const workerB = persistedState.members.find((member) => member.name === "worker-b")
    expect(workerA?.status).toBe("errored")
    expect(workerB?.status).toBe("errored")
    expect(workerB?.sessionId).toBeUndefined()
    expect(report.resumed).toBe(0)
    expect(report.marked_orphaned).toBe(1)
  })
})
