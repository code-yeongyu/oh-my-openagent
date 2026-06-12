import { afterEach, describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { BackgroundManager } from "../../background-agent/manager"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { createTask } from "../team-tasklist/store"
import { createTaskInput } from "../team-tasklist/test-support"
import { getInboxDir, getTasksDir, resolveBaseDir } from "../team-registry/paths"
import { createRuntimeState, saveRuntimeState } from "../team-state-store/store"
import { aggregateStatus } from "./status"

async function createTemporaryBaseDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mode-status-"))
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

async function seedRuntimeState(baseDir: string, teamName: string, leadSessionId: string, memberSessionIds: string[]): Promise<string> {
  const config = createConfig(baseDir)
  const runtimeState = await createRuntimeState(
    {
      version: 1,
      name: teamName,
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true, color: "red" },
        ...memberSessionIds.map((sessionID, index) => ({
          kind: "category" as const,
          name: `member-${index + 1}`,
          category: "deep" as const,
          prompt: "implement task",
          backendType: "in-process" as const,
          isActive: true,
          color: index === 0 ? "blue" : "green",
        })),
      ],
    },
    leadSessionId,
    "project",
    config,
  )
  const updatedRuntimeState = {
    ...runtimeState,
    members: runtimeState.members.map((member, index) => index === 0 ? { ...member, sessionId: leadSessionId, status: "running" as const } : { ...member, sessionId: memberSessionIds[index - 1], status: "running" as const }),
  }
  await saveRuntimeState(updatedRuntimeState, config)
  return updatedRuntimeState.teamRunId
}

describe("aggregateStatus", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => rm(directoryPath, { recursive: true, force: true })))
  })

  test("surfaces stale locks from claims directory", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const teamRunId = await seedRuntimeState(baseDir, "team-gamma", "lead-3", [])
    const claimsDir = path.join(getTasksDir(resolveBaseDir(config), teamRunId), "claims")
    await mkdir(claimsDir, { recursive: true })
    const claimedTask = await createTask(teamRunId, createTaskInput(), config)
    await writeFile(path.join(claimsDir, `${claimedTask.id}.lock`), "owner\n999999\n1\n")

    // when
    const result = await aggregateStatus(teamRunId, config)

    // then
    expect(result.staleLocks).toEqual([path.join(claimsDir, `${claimedTask.id}.lock`)])
  })

  test("aggregates members plus tasks plus unread counts", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const teamRunId = await seedRuntimeState(baseDir, "team-alpha", "lead-1", ["session-a", "session-b"])
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "member-1")
    await mkdir(inboxDir, { recursive: true })
    await writeFile(path.join(inboxDir, "1.json"), JSON.stringify({ version: 1, messageId: randomUUID(), from: "lead", to: "member-1", kind: "message", body: "a", timestamp: 1 }) + "\n")
    await writeFile(path.join(inboxDir, "2.json"), JSON.stringify({ version: 1, messageId: randomUUID(), from: "lead", to: "member-1", kind: "message", body: "b", timestamp: 2 }) + "\n")
    await createTask(teamRunId, createTaskInput({ subject: "a" }), config)
    await createTask(teamRunId, createTaskInput({ subject: "b" }), config)
    await createTask(teamRunId, createTaskInput({ subject: "c" }), config)
    await createTask(teamRunId, createTaskInput({ subject: "d" }), config)

    // when
    const result = await aggregateStatus(teamRunId, config)

    // then
    expect(result.teamName).toBe("team-alpha")
    expect(result.members).toEqual([
      expect.objectContaining({ name: "lead", unreadMessages: 0 }),
      expect.objectContaining({ name: "member-1", unreadMessages: 2 }),
      expect.objectContaining({ name: "member-2", unreadMessages: 0 }),
    ])
    expect(Object.keys(result.members[0] ?? {})).toEqual(expect.arrayContaining(["name", "unreadMessages"]))
    expect(result.tasks).toEqual({ pending: 4, claimed: 0, in_progress: 0, completed: 0, deleted: 0, total: 4 })
  })

  test("surfaces queued and running counts on same model", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    temporaryDirectories.push(baseDir)
    const config = createConfig(baseDir)
    const teamRunId = await seedRuntimeState(baseDir, "team-beta", "lead-2", [])
    const backgroundManager = {
      getTasksByParentSession: () => [
        { status: "running", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
        { status: "running", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
        { status: "running", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
        { status: "running", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
        { status: "running", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
        { status: "pending", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
        { status: "pending", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
        { status: "pending", model: { providerID: "anthropic", modelID: "claude-opus-4-7" } },
      ],
      getConcurrencyCounts: () => ({ running: 5, queued: 3 }),
      listTasksByParentSession: () => [{}, {}, {}, {}],
    } satisfies Pick<BackgroundManager, "getTasksByParentSession"> & {
      getConcurrencyCounts?: (modelOrUndefined?: string) => { running: number; queued: number }
      listTasksByParentSession?: (sessionID: string) => unknown[]
    }

    // when
    const result = await aggregateStatus(teamRunId, config, backgroundManager)

    // then
    expect(result.concurrency.runningOnSameModel).toBe(5)
    expect(result.concurrency.queuedOnSameModel).toBe(3)
    expect(result.concurrency.teamRunIdSpecific).toBe(4)
  })
})
