/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdir, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import type { ExecutorContext } from "../../tools/delegate-task/executor-types"
import type { LiveDeliveryClient } from "./tools/messaging"
import { BackgroundManager } from "../background-agent/manager"
import type { BackgroundTask, LaunchInput } from "../background-agent/types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "../../shared/session-prompt-params-state"
import { getRuntimeStateDir, resolveBaseDir } from "./team-registry/paths"
import type { TeamSpec } from "./types"

const resolveMemberMock = mock(async (member: TeamSpec["members"][number]) => ({
  agentToUse: `${member.name}-agent`,
  model: {
    providerID: "openai",
    modelID: "gpt-5.4-mini",
    variant: "medium",
    reasoningEffort: "high",
    temperature: 0.1,
    top_p: 0.9,
    maxTokens: 2048,
    thinking: { type: "enabled", budgetTokens: 1024 },
  },
  fallbackChain: undefined,
  systemContent: `system:${member.name}`,
}))

mock.module("./team-runtime/resolve-member", () => ({ resolveMember: resolveMemberMock }))

const { sendMessage } = await import("./team-mailbox/send")
const { createTeamRun } = await import("./team-runtime/create")
const { deleteTeam } = await import("./team-runtime/shutdown")
const { aggregateStatus } = await import("./team-runtime/status")
const { createTask, claimTask, listTasks, updateTaskStatus } = await import("./team-tasklist")
const { resumeAllTeams } = await import("./team-state-store/resume")
const { loadRuntimeState, saveRuntimeState } = await import("./team-state-store/store")

const temporaryDirectories: string[] = []
type MockClient = ExecutorContext["client"] & { session: { get: ReturnType<typeof mock> } }

function createConfig(baseDir: string, overrides: Partial<TeamModeConfig> = {}): TeamModeConfig {
  return TeamModeConfigSchema.parse({ enabled: true, base_dir: baseDir, max_wall_clock_minutes: 1, ...overrides })
}

function createSpec(name: string, leadAgentId: string, members: TeamSpec["members"]): TeamSpec {
  return { version: 1, name, createdAt: Date.now(), leadAgentId, members }
}

function createClient(aliveSessionIds: ReadonlySet<string>): MockClient {
  return {
    session: {
      get: mock(async ({ path: { id } }: { path: { id: string } }) => aliveSessionIds.has(id)
        ? { data: { id } }
        : { error: Object.assign(new Error("session not found"), { status: 404 }) }),
    },
  } as MockClient
}

function createManager(launchImpl?: (input: LaunchInput) => Promise<BackgroundTask>) {
  const manager = Object.create(BackgroundManager.prototype) as BackgroundManager
  let launchCount = 0
  manager.launch = mock((input: LaunchInput) => launchImpl?.(input) ?? Promise.resolve({
    id: `task-${++launchCount}`,
    sessionId: `ses_mock_${randomUUID()}`,
    status: "running",
  } as BackgroundTask))
  manager.getTask = mock(() => undefined)
  manager.cancelTask = mock(async () => true)
  manager.getTasksByParentSession = mock(() => [])
  return manager
}

function createContext(directory: string, manager: BackgroundManager, aliveSessionIds: ReadonlySet<string>): ExecutorContext {
  return { client: createClient(aliveSessionIds), manager, directory }
}

async function createBaseDir(): Promise<string> {
  const directory = path.join(tmpdir(), `team-mode-int-${randomUUID()}`)
  temporaryDirectories.push(directory)
  await mkdir(directory, { recursive: true })
  return directory
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  resolveMemberMock.mockClear()
  SessionCategoryRegistry.clear()
  clearAllSessionPromptParams()
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

describe("team-mode integration", () => {
  test("C-10.1 creates a single-member echo team, delivers mail, surfaces unread status, and deletes runtime", async () => {
    // given
    const baseDir = await createBaseDir()
    const config = createConfig(baseDir)
    const manager = createManager()
    const runtime = await createTeamRun(createSpec("echo-team", "echo", [{ kind: "subagent_type", name: "echo", subagent_type: "atlas", backendType: "in-process", isActive: true }]), "ses_lead", createContext(baseDir, manager, new Set(["ses_lead"])), config, manager)

    // when
    const delivered = await sendMessage({ version: 1, messageId: randomUUID(), from: "echo", to: "echo", kind: "message", body: "hello", timestamp: Date.now() }, runtime.teamRunId, config, { isLead: true, activeMembers: ["echo"] })
    const status = await aggregateStatus(runtime.teamRunId, config)
    await deleteTeam(runtime.teamRunId, config, undefined, manager)

    // then
    expect(runtime.status).toBe("active")
    expect(runtime.members).toHaveLength(1)
    expect(runtime.members[0]?.sessionId).toMatch(/^ses_mock_/) 
    expect(delivered.deliveredTo).toEqual(["echo"])
    expect(status.members[0]?.unreadMessages).toBe(1)
    expect(await exists(getRuntimeStateDir(resolveBaseDir(config), runtime.teamRunId))).toBe(false)
  })

  test("C-10.2 runs a 2-member pipeline where worker claims and completes a lead-created task", async () => {
    // given
    const baseDir = await createBaseDir()
    const config = createConfig(baseDir)
    const manager = createManager()
    const runtime = await createTeamRun(createSpec("pipeline-team", "lead", [
      { kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true },
      { kind: "subagent_type", name: "worker", subagent_type: "atlas", backendType: "in-process", isActive: true },
    ]), "ses_lead", createContext(baseDir, manager, new Set(["ses_lead"])), config, manager)
    const createdTask = await createTask(runtime.teamRunId, { subject: "X", description: "Ship X", blocks: [], blockedBy: [], status: "pending" }, config)

    // when
    const claimedTask = await claimTask(runtime.teamRunId, createdTask.id, "worker", config)
    await updateTaskStatus(runtime.teamRunId, createdTask.id, "in_progress", "worker", config)
    await updateTaskStatus(runtime.teamRunId, createdTask.id, "completed", "worker", config)
    const completedTasks = await listTasks(runtime.teamRunId, config, { status: "completed" })

    // then
    expect(claimedTask.status).toBe("claimed")
    expect(claimedTask.owner).toBe("worker")
    expect(completedTasks).toHaveLength(1)
    expect(completedTasks[0]?.subject).toBe("X")
  })

  test("C-10.3 resumes alive teams, orphans dead leads, fails stuck creating teams, and cleans deleting runs", async () => {
    // given
    const baseDir = await createBaseDir()
    const aliveSessionIds = new Set(["ses_alive"])
    const config = createConfig(baseDir)
    const manager = createManager()
    const context = createContext(baseDir, manager, aliveSessionIds)
    const aliveRuntime = await createTeamRun(createSpec("alive-team", "lead", [{ kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true }]), "ses_alive", context, config, manager)
    const deadRuntime = await createTeamRun(createSpec("dead-team", "lead", [{ kind: "subagent_type", name: "lead", subagent_type: "atlas", backendType: "in-process", isActive: true }]), "ses_dead", context, config, manager)
    const stuckRuntime = await createTeamRun(createSpec("stuck-team", "lead", [{ kind: "subagent_type", name: "lead", subagent_type: "atlas", backendType: "in-process", isActive: true }]), "ses_stuck", context, config, manager)
    const deletingRuntime = await createTeamRun(createSpec("deleting-team", "lead", [{ kind: "subagent_type", name: "lead", subagent_type: "atlas", backendType: "in-process", isActive: true }]), "ses_delete", context, config, manager)
    await saveRuntimeState({ ...(await loadRuntimeState(stuckRuntime.teamRunId, config)), status: "creating", createdAt: Date.now() - 40 * 60 * 1000 }, config)
    await saveRuntimeState({ ...(await loadRuntimeState(deletingRuntime.teamRunId, config)), status: "deleting" }, config)

    // when
    const report = await resumeAllTeams(context, config)

    // then
    expect(report).toEqual({ resumed: 1, marked_failed: 1, marked_orphaned: 1, cleaned: 1, errors: [] })
    expect((await loadRuntimeState(aliveRuntime.teamRunId, config)).status).toBe("active")
    expect((await loadRuntimeState(deadRuntime.teamRunId, config)).status).toBe("orphaned")
    expect((await loadRuntimeState(stuckRuntime.teamRunId, config)).status).toBe("failed")
    expect(await exists(getRuntimeStateDir(resolveBaseDir(config), deletingRuntime.teamRunId))).toBe(false)
  })

  test("C-10.5 end-to-end: createTeamRun persists category-aware routing and team_send_message reapplies it on promptAsync", async () => {
    // given - a 2-member team; resolveMemberMock returns agentToUse + model per member
    const baseDir = await createBaseDir()
    const config = createConfig(baseDir)
    const manager = createManager()

    type RecordedPrompt = {
      sessionId: string
      agent?: string
      model?: { providerID: string; modelID: string }
      variant?: string
      directory?: string
    }
    const recorded: RecordedPrompt[] = []
    const promptAsyncSpy = mock(async (input: {
      path: { id: string }
      body: {
        parts: Array<{ type: string; text?: string }>
        agent?: string
        model?: { providerID: string; modelID: string }
        variant?: string
      }
      query?: { directory: string }
    }) => {
      recorded.push({
        sessionId: input.path.id,
        agent: input.body.agent,
        model: input.body.model,
        variant: input.body.variant,
        directory: input.query?.directory,
      })
      return undefined
    })
    const recordingClient = {
      session: {
        get: mock(async ({ path: { id } }: { path: { id: string } }) => ({ data: { id } })),
        promptAsync: promptAsyncSpy,
      },
    } as ExecutorContext["client"] & LiveDeliveryClient
    const ctx = { client: recordingClient, manager, directory: baseDir }

    const runtime = await createTeamRun(createSpec("msg-team", "lead", [
      { kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true },
      { kind: "category", name: "worker", category: "quick", prompt: "work the queue", backendType: "in-process", isActive: true },
    ]), "ses_lead", ctx, config, manager)

    const leadMember = runtime.members.find((member) => member.name === "lead")
    const workerMember = runtime.members.find((member) => member.name === "worker")
    if (!leadMember?.sessionId || !workerMember?.sessionId) {
      throw new Error("expected both team members to hold sessionIds")
    }

    const { createTeamSendMessageTool } = await import("./tools/messaging")
    const tool = createTeamSendMessageTool(config, recordingClient)

    // when - the lead (via its spawned session) sends a live message to the worker
    const toolContext = {
      sessionID: leadMember.sessionId,
      messageID: randomUUID(),
      agent: "test-agent",
      directory: baseDir,
      worktree: baseDir,
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => undefined,
    } as Parameters<ReturnType<typeof createTeamSendMessageTool>["execute"]>[1]

    await tool.execute({
      teamRunId: runtime.teamRunId,
      to: "worker",
      body: "integration-ping",
    }, toolContext)

    // then - runtime state carries the resolved identity end-to-end, and promptAsync receives it
    const persistedRuntime = await loadRuntimeState(runtime.teamRunId, config)
    const persistedWorker = persistedRuntime.members.find((member) => member.name === "worker")
    expect(persistedWorker?.subagent_type).toBe("worker-agent")
    expect(persistedWorker?.category).toBe("quick")
    expect(persistedWorker?.model).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4-mini",
      variant: "medium",
      reasoningEffort: "high",
      temperature: 0.1,
      top_p: 0.9,
      maxTokens: 2048,
      thinking: { type: "enabled", budgetTokens: 1024 },
    })

    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.sessionId).toBe(workerMember.sessionId)
    expect(recorded[0]?.agent).toBe("worker-agent")
    expect(recorded[0]?.model).toEqual({ providerID: "openai", modelID: "gpt-5.4-mini" })
    expect(recorded[0]?.variant).toBe("medium")
    expect(recorded[0]?.directory).toBe(baseDir)
    expect(SessionCategoryRegistry.get(workerMember.sessionId)).toBe("quick")
    expect(getSessionPromptParams(workerMember.sessionId)).toEqual({
      temperature: 0.1,
      topP: 0.9,
      maxOutputTokens: 2048,
      options: {
        reasoningEffort: "high",
        thinking: { type: "enabled", budgetTokens: 1024 },
      },
    })
  })

  test("C-10.4 keeps member spawn concurrency within max_parallel_members", async () => {
    // given
    const baseDir = await createBaseDir()
    let inFlight = 0
    let maxInFlight = 0
    const manager = createManager(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
      return { id: `task-${randomUUID()}`, sessionId: `ses_mock_${randomUUID()}`, status: "running" } as BackgroundTask
    })

    // when
    await createTeamRun(createSpec("parallel-team", "lead", [
      { kind: "subagent_type", name: "lead", subagent_type: "sisyphus", backendType: "in-process", isActive: true },
      { kind: "subagent_type", name: "worker-a", subagent_type: "atlas", backendType: "in-process", isActive: true },
      { kind: "subagent_type", name: "worker-b", subagent_type: "atlas", backendType: "in-process", isActive: true },
    ]), "ses_lead", createContext(baseDir, manager, new Set(["ses_lead"])), createConfig(baseDir, { max_parallel_members: 2 }), manager)

    // then
    expect(maxInFlight).toBeLessThanOrEqual(2)
  })
})
