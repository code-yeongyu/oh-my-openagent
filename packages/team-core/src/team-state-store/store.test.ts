/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../config"
import type { TeamModeConfig } from "../config"
import { RuntimeStateSchema, type ActiveTeamSummary, type RuntimeState, type TeamSpec } from "../types"
import {
  clearLayoutCleanupRecovery,
  hasPendingLayoutCleanup,
  isIncompleteLayoutCleanupResult,
  InvalidTransitionError,
  RuntimeStateError,
  STALE_DELETING_TTL_MS,
  createRuntimeState,
  listActiveTeams,
  loadRuntimeState,
  preserveLayoutCleanupRecovery,
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

  test("#given persisted tmux cleanup identity #when runtime state is parsed #then only the non-secret backend target is accepted", async () => {
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec(), undefined, "user", config)

    const parsed = RuntimeStateSchema.parse({
      ...runtimeState,
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$7",
        paneIds: ["%11"],
        executionTarget: {
          backend: "cmux",
          cmuxSocketPath: "/tmp/cmux.sock",
        },
      },
    })

    expect(parsed.tmuxLayout?.executionTarget).toEqual({
      backend: "cmux",
      cmuxSocketPath: "/tmp/cmux.sock",
    })
    expect(RuntimeStateSchema.safeParse({
      ...runtimeState,
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$7",
        paneIds: ["%11"],
        executionTarget: {
          backend: "tmux",
          tmuxEnvironment: "/tmp/tmux.sock,123,0",
          executablePath: "/private/bin/tmux",
          paneEnvironment: { TEAM_ACCESS_TOKEN: "must-not-persist" },
        },
      },
    }).success).toBe(false)
    for (const executionTarget of [
      {
        backend: "tmux",
        tmuxEnvironment: "/tmp/cmuxterm-invalid.sock,1,0",
      },
      {
        backend: "cmux",
        cmuxSocketPath: "/tmp/cmux.sock",
        tmuxEnvironment: "/tmp/native-tmux.sock,1,0",
      },
    ]) {
      expect(RuntimeStateSchema.safeParse({
        ...runtimeState,
        tmuxLayout: {
          ownedSession: false,
          targetSessionId: "$7",
          paneIds: ["%11"],
          executionTarget,
        },
      }).success).toBe(false)
    }
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

  test("#given an active runtime with a lead session w2tc #when active teams are listed #then the typed summary carries leadSessionId", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec("lead-session-team"), "lead-session-14", "project", config)

    // when
    const activeTeams = await listActiveTeams(config)
    const summary: ActiveTeamSummary | undefined = activeTeams[0]

    // then
    expect(summary).toEqual({
      teamRunId: runtimeState.teamRunId,
      teamName: "lead-session-team",
      status: "creating",
      memberCount: 2,
      scope: "project",
      leadSessionId: "lead-session-14",
    })
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

  test("listActiveTeams preserves stale deleting runtimes with pending layout cleanup", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec("pending-layout-cleanup-team"), undefined, "user", config)
    const pendingCleanupState = {
      ...runtimeState,
      status: "deleting" as const,
      layoutCleanupPending: true,
      members: runtimeState.members.map((member) => member.name === "worker"
        ? { ...member, tmuxPaneId: "%pending" }
        : member),
    }
    await saveRuntimeState(pendingCleanupState, config)
    const staleTimestamp = new Date(Date.now() - STALE_DELETING_TTL_MS - 1_000)
    await utimes(path.join(baseDir, "runtime", runtimeState.teamRunId, "state.json"), staleTimestamp, staleTimestamp)

    // when
    const activeTeams = await listActiveTeams(config)

    // then
    expect(activeTeams).toEqual([{
      teamRunId: runtimeState.teamRunId,
      teamName: runtimeState.teamName,
      status: "deleting",
      memberCount: runtimeState.members.length,
      scope: "user",
    }])
    const persistedState = await loadRuntimeState(runtimeState.teamRunId, config)
    expect(persistedState.layoutCleanupPending).toBe(true)
  })

  test("clearLayoutCleanupRecovery atomically consumes all persisted tmux recovery references", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec("completed-layout-cleanup-team"), undefined, "user", config)
    const stateWithLayoutRecovery: RuntimeState = {
      ...runtimeState,
      status: "deleting",
      layoutCleanupPending: true,
      members: runtimeState.members.map((member) => member.name === "worker"
        ? { ...member, tmuxPaneId: "%worker", tmuxGridPaneId: "%grid" }
        : member),
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%layout"],
        executionTarget: {
          backend: "tmux",
          tmuxEnvironment: "/tmp/tmux.sock,123,0",
        },
      },
    }

    // when
    const clearedState = clearLayoutCleanupRecovery(stateWithLayoutRecovery)

    // then
    expect(clearedState.layoutCleanupPending).toBeUndefined()
    expect(clearedState.tmuxLayout).toBeUndefined()
    expect(clearedState.members.every((member) => (
      member.tmuxPaneId === undefined && member.tmuxGridPaneId === undefined
    ))).toBe(true)
    expect(hasPendingLayoutCleanup(clearedState)).toBe(false)
  })

  test("allows a creating runtime to enter recoverable deletion and finish as failed", async () => {
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec("rollback-recovery-team"), undefined, "user", config)

    const deletingState = await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...currentRuntimeState,
      status: "deleting",
      layoutCleanupPending: true,
    }), config)
    const failedState = await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...clearLayoutCleanupRecovery(currentRuntimeState),
      status: "failed",
    }), config)

    expect(deletingState.status).toBe("deleting")
    expect(deletingState.layoutCleanupPending).toBe(true)
    expect(failedState.status).toBe("failed")
    expect(hasPendingLayoutCleanup(failedState)).toBe(false)
  })

  test("preserveLayoutCleanupRecovery prunes only panes confirmed removed", async () => {
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const runtimeState = await createRuntimeState(createSpec("partial-layout-cleanup-team"), undefined, "user", config)
    const stateWithLayoutRecovery: RuntimeState = {
      ...runtimeState,
      members: runtimeState.members.map((member) => member.name === "worker"
        ? { ...member, tmuxPaneId: "%removed", tmuxGridPaneId: "%pending" }
        : member),
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%removed", "%pending", "%legacy"],
      },
    }
    const cleanupResult = {
      attemptedPaneIds: ["%removed", "%pending"],
      removedPaneIds: ["%removed"],
      skippedPaneIds: ["%pending"],
      reason: "partial" as const,
    }

    const preservedState = preserveLayoutCleanupRecovery(stateWithLayoutRecovery, cleanupResult)

    expect(isIncompleteLayoutCleanupResult(cleanupResult)).toBe(true)
    expect(preservedState.layoutCleanupPending).toBe(true)
    expect(preservedState.tmuxLayout?.paneIds).toEqual(["%pending", "%legacy"])
    expect(preservedState.tmuxLayout?.targetSessionId).toBe("$caller")
    expect(preservedState.members.find((member) => member.name === "worker")?.tmuxPaneId).toBeUndefined()
    expect(preservedState.members.find((member) => member.name === "worker")?.tmuxGridPaneId).toBe("%pending")
  })

  test("classifies only non-terminal layout cleanup outcomes as incomplete", () => {
    const incompleteReasons = [
      "backend-unavailable",
      "failed",
      "invalid-execution-target",
      "missing-execution-target",
      "partial",
    ] as const
    const completeReasons = ["missing-pane-identifiers", "no-owned-panes", "removed"] as const

    for (const reason of incompleteReasons) {
      expect(isIncompleteLayoutCleanupResult({
        attemptedPaneIds: [],
        removedPaneIds: [],
        skippedPaneIds: [],
        reason,
      })).toBe(true)
    }
    for (const reason of completeReasons) {
      expect(isIncompleteLayoutCleanupResult({
        attemptedPaneIds: [],
        removedPaneIds: [],
        skippedPaneIds: [],
        reason,
      })).toBe(false)
    }
  })
})
