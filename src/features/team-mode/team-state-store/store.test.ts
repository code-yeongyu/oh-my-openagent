/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { RuntimeState, TeamSpec } from "../types"
import {
  InvalidTransitionError,
  RuntimeStateError,
  STALE_DELETING_TTL_MS,
  createRuntimeState,
  listActiveTeams,
  loadRuntimeState,
  saveRuntimeState,
  transitionRuntimeState,
} from "./store"

async function createTemporaryBaseDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mode-store-"))
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

async function seedRuntimeState(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  saveRuntimeState: (runtimeState: RuntimeState, config: TeamModeConfig) => Promise<void>,
): Promise<void> {
  await mkdir(path.join(config.base_dir ?? "", "runtime", runtimeState.teamRunId), { recursive: true })
  await saveRuntimeState(runtimeState, config)
}

async function runtimeDirectoryExists(baseDir: string, teamRunId: string): Promise<boolean> {
  try {
    await stat(path.join(baseDir, "runtime", teamRunId))
    return true
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === "ENOENT") return false
    throw error
  }
}

describe("runtime state store", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("createRuntimeState persists creating state with computed bounds", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)

    // when
    const runtimeState = await createRuntimeState(createSpec(), undefined, "user", config)
    const persistedState = JSON.parse(await readFile(path.join(baseDir, "runtime", runtimeState.teamRunId, "state.json"), "utf8"))

    // then
    expect(runtimeState.teamRunId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
    expect(runtimeState.status).toBe("creating")
    expect(runtimeState.leadSessionId).toBeUndefined()
    expect(runtimeState.bounds).toEqual({
      maxMembers: 6,
      maxParallelMembers: 3,
      maxMessagesPerRun: 200,
      maxWallClockMinutes: 45,
      maxMemberTurns: 50,
    })
    expect(runtimeState.members).toEqual([
      expect.objectContaining({ name: "lead", agentType: "leader", status: "pending", pendingInjectedMessageIds: [] }),
      expect.objectContaining({ name: "worker", agentType: "general-purpose", status: "pending", pendingInjectedMessageIds: [] }),
    ])
    expect(persistedState.status).toBe("creating")
  })

  test("loadRuntimeState throws RuntimeStateError for malformed state", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", teamRunId), { recursive: true })
    await writeFile(path.join(baseDir, "runtime", teamRunId, "state.json"), "{not-json")

    // when
    const result = loadRuntimeState(teamRunId, config)

    // then
    expect(result).rejects.toBeInstanceOf(RuntimeStateError)
  })

  test("transitionRuntimeState allows active to shutdown_requested", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const createdState = await createRuntimeState(createSpec(), "lead-session", "project", config)

    // when
    await transitionRuntimeState(createdState.teamRunId, (runtimeState) => ({ ...runtimeState, status: "active" }), config)
    const runtimeState = await transitionRuntimeState(
      createdState.teamRunId,
      (currentRuntimeState) => ({ ...currentRuntimeState, status: "shutdown_requested" }),
      config,
    )

    // then
    expect(runtimeState.status).toBe("shutdown_requested")
    expect((await loadRuntimeState(createdState.teamRunId, config)).status).toBe("shutdown_requested")
  })

  test("transitionRuntimeState rejects reverse transition", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const createdState = await createRuntimeState(createSpec(), undefined, "user", config)
    await seedRuntimeState({ ...createdState, status: "deleted" }, config, saveRuntimeState)

    // when
    const result = transitionRuntimeState(
      createdState.teamRunId,
      (runtimeState) => ({ ...runtimeState, status: "active" }),
      config,
    )

    // then
    expect(result).rejects.toBeInstanceOf(InvalidTransitionError)
    expect((await loadRuntimeState(createdState.teamRunId, config)).status).toBe("deleted")
  })

  test("loadRuntimeState ignores crash-left tmp files and keeps valid persisted state", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), undefined, "user", config)
    const statePath = path.join(baseDir, "runtime", runtimeState.teamRunId, "state.json")
    await writeFile(`${statePath}.tmp.mock-crash`, JSON.stringify({ ...runtimeState, status: "active" }))

    // when
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(persistedState.status).toBe("creating")
  })

  test("loadRuntimeState accepts legacy member delegate counters without preserving them", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), undefined, "user", config)
    const statePath = path.join(baseDir, "runtime", runtimeState.teamRunId, "state.json")
    await writeFile(statePath, JSON.stringify({
      ...runtimeState,
      members: runtimeState.members.map((member) => ({ ...member, delegateTaskCallsUsed: 3 })),
    }))

    // when
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)

    // then
    expect(persistedState.members).toHaveLength(2)
    expect(Object.keys(persistedState.members[0] ?? {})).not.toContain("delegateTaskCallsUsed")
  })

  test("listActiveTeams skips malformed runtime states and logs them", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const firstState = await createRuntimeState(createSpec("alpha-team"), undefined, "user", config)
    const secondState = await createRuntimeState(createSpec("beta-team"), undefined, "project", config)
    const malformedTeamRunId = randomUUID()
    await mkdir(path.join(baseDir, "runtime", malformedTeamRunId), { recursive: true })
    await writeFile(path.join(baseDir, "runtime", malformedTeamRunId, "state.json"), "{oops")

    // when
    const activeTeams = await listActiveTeams(config)

    // then
    expect(activeTeams).toEqual([
      { teamRunId: firstState.teamRunId, teamName: "alpha-team", status: "creating", memberCount: 2, scope: "user" },
      { teamRunId: secondState.teamRunId, teamName: "beta-team", status: "creating", memberCount: 2, scope: "project" },
    ])
  })

  test("listActiveTeams removes deleted runtime directories left by interrupted cleanup", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec("deleted-team"), undefined, "user", config)
    await saveRuntimeState({ ...runtimeState, status: "deleted" }, config)

    // when
    const activeTeams = await listActiveTeams(config)

    // then
    expect(activeTeams).toEqual([])
    expect(await runtimeDirectoryExists(baseDir, runtimeState.teamRunId)).toBe(false)
  })

  test("listActiveTeams removes deleting runtimes that have been stuck past the stale timeout", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec("stuck-delete-team"), undefined, "user", config)
    await saveRuntimeState({ ...runtimeState, status: "deleting" }, config)
    const staleTimestamp = new Date(Date.now() - STALE_DELETING_TTL_MS - 1_000)
    await utimes(path.join(baseDir, "runtime", runtimeState.teamRunId, "state.json"), staleTimestamp, staleTimestamp)

    // when
    const activeTeams = await listActiveTeams(config)

    // then
    expect(activeTeams).toEqual([])
    expect(await runtimeDirectoryExists(baseDir, runtimeState.teamRunId)).toBe(false)
  })
})
