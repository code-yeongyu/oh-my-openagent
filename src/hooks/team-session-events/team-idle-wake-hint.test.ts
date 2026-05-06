/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp, mkdir, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../../config/schema/team-mode"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import * as ackModule from "../../features/team-mode/team-mailbox/ack"
import { sendMessage } from "../../features/team-mode/team-mailbox/send"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import { getInboxDir, resolveBaseDir } from "../../features/team-mode/team-registry/paths"
import { loadRuntimeState, saveRuntimeState } from "../../features/team-mode/team-state-store/store"
import type { RuntimeState } from "../../features/team-mode/types"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "../../shared/session-prompt-params-state"
import { createTeamIdleWakeHint } from "./team-idle-wake-hint"

type WakeHintPromptInput = {
  path: { id: string }
  body: {
    parts: Array<{ type: "text"; text: string }>
    agent?: string
    model?: { providerID: string; modelID: string }
    variant?: string
    temperature?: number
    topP?: number
    maxOutputTokens?: number
    options?: Record<string, unknown>
  }
  query: { directory: string }
}

const temporaryDirectories: string[] = []

async function createTemporaryBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-idle-wake-hint-"))
  temporaryDirectories.push(baseDir)
  return baseDir
}

function createConfig(baseDir: string): TeamModeConfig {
  return TeamModeConfigSchema.parse({ base_dir: baseDir, enabled: true })
}

function createRuntimeState(teamRunId: string, pendingInjectedMessageIds: string[] = []): RuntimeState {
  return {
    version: 1,
    teamRunId,
    teamName: "team-alpha",
    specSource: "project",
    createdAt: 1,
    status: "active",
    leadSessionId: "lead-session",
    members: [
      {
        name: "worker",
        sessionId: "member-session",
        agentType: "general-purpose",
        status: "idle",
        pendingInjectedMessageIds,
      },
    ],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
  }
}

async function seedRuntimeState(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void> {
  await mkdir(path.join(config.base_dir ?? "", "runtime", runtimeState.teamRunId), { recursive: true })
  await saveRuntimeState(runtimeState, config)
}

async function seedUnreadMessage(
  teamRunId: string,
  config: TeamModeConfig,
  messageId: string,
  body: string,
  timestamp: number,
): Promise<void> {
  await sendMessage({
    version: 1,
    messageId,
    from: "lead",
    to: "worker",
    kind: "message",
    body,
    timestamp,
  }, teamRunId, config, { isLead: true, activeMembers: ["worker"] })
}

afterEach(async () => {
  clearTeamSessionRegistry()
  SessionCategoryRegistry.clear()
  clearAllSessionPromptParams()
  await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
    await rm(directoryPath, { recursive: true, force: true })
  }))
})

describe("createTeamIdleWakeHint", () => {
  test("sends a trigger-only wake hint when new unread mail exists", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId), config)
    await seedUnreadMessage(teamRunId, config, randomUUID(), "first message body", 100)
    await seedUnreadMessage(teamRunId, config, randomUUID(), "second message body", 200)

    const promptInputs: Array<WakeHintPromptInput> = []
    const promptAsyncSpy = mock(async (input: WakeHintPromptInput) => {
      promptInputs.push(input)
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "member-session" },
      },
    })
    
    // then
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1)
    const promptInput = promptInputs[0]
    if (promptInput === undefined) {
      throw new Error("expected wake hint prompt input")
    }
    expect(promptInput.path).toEqual({ id: "member-session" })
    expect(promptInput.body.parts[0]?.text).toContain("2 new team messages")
    expect(promptInput.body.parts[0]?.text).not.toContain("first message body")
    expect(promptInput.body.parts[0]?.text).not.toContain("second message body")
  })

  test("pins the recipient's resolved subagent_type and model on the wake-hint promptAsync", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const runtimeState = createRuntimeState(teamRunId)
    const worker = runtimeState.members[0]
    if (!worker) throw new Error("worker member missing from fixture")
    worker.subagent_type = "atlas"
    worker.model = { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "high" }
    await seedRuntimeState(runtimeState, config)
    await seedUnreadMessage(teamRunId, config, randomUUID(), "hello", 100)

    const promptInputs: Array<WakeHintPromptInput> = []
    const promptAsyncSpy = mock(async (input: WakeHintPromptInput) => {
      promptInputs.push(input)
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "member-session" },
      },
    })

    // then
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1)
    const promptInput = promptInputs[0]
    if (promptInput === undefined) {
      throw new Error("expected wake hint prompt input")
    }
    expect(promptInput.body.agent).toBe("atlas")
    expect(promptInput.body.model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
    expect(promptInput.body.variant).toBe("high")
  })

  test("reapplies category routing and advanced prompt params on wake hints", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const runtimeState = createRuntimeState(teamRunId)
    const worker = runtimeState.members[0]
    if (!worker) throw new Error("worker member missing from fixture")
    worker.subagent_type = "Sisyphus-Junior"
    worker.category = "quick"
    worker.model = {
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "medium",
      reasoningEffort: "high",
      temperature: 0.2,
      top_p: 0.8,
      maxTokens: 4096,
      thinking: { type: "enabled", budgetTokens: 2048 },
    }
    await seedRuntimeState(runtimeState, config)
    await seedUnreadMessage(teamRunId, config, randomUUID(), "hello", 100)

    const promptInputs: Array<WakeHintPromptInput> = []
    const promptAsyncSpy = mock(async (input: WakeHintPromptInput) => {
      promptInputs.push(input)
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "member-session" },
      },
    })

    // then
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1)
    const promptInput = promptInputs[0]
    if (promptInput === undefined) {
      throw new Error("expected wake hint prompt input")
    }
    expect(promptInput.body.agent).toBe("Sisyphus-Junior")
    expect(promptInput.body.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(promptInput.body.variant).toBe("medium")
    expect(promptInput.body.temperature).toBe(0.2)
    expect(promptInput.body.topP).toBe(0.8)
    expect(promptInput.body.maxOutputTokens).toBe(4096)
    expect(promptInput.body.options).toEqual({
      reasoningEffort: "high",
      thinking: { type: "enabled", budgetTokens: 2048 },
    })
    expect(SessionCategoryRegistry.get("member-session")).toBe("quick")
    expect(getSessionPromptParams("member-session")).toEqual({
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 4096,
      options: {
        reasoningEffort: "high",
        thinking: { type: "enabled", budgetTokens: 2048 },
      },
    })
  })

  test("omits agent and model on the wake-hint promptAsync when the member has none recorded", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    await seedRuntimeState(createRuntimeState(teamRunId), config)
    await seedUnreadMessage(teamRunId, config, randomUUID(), "hello", 100)

    const promptInputs: Array<WakeHintPromptInput> = []
    const promptAsyncSpy = mock(async (input: WakeHintPromptInput) => {
      promptInputs.push(input)
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "member-session" },
      },
    })

    // then
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1)
    const promptInput = promptInputs[0]
    if (promptInput === undefined) {
      throw new Error("expected wake hint prompt input")
    }
    expect(promptInput.body.agent).toBeUndefined()
    expect(promptInput.body.model).toBeUndefined()
    expect(promptInput.body.variant).toBeUndefined()
  })

  test("acks pending messages on idle, moves files to processed, and clears pending ids", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const messageIds = [randomUUID(), randomUUID(), randomUUID()]
    await seedRuntimeState(createRuntimeState(teamRunId, messageIds), config)
    await seedUnreadMessage(teamRunId, config, messageIds[0], "one", 100)
    await seedUnreadMessage(teamRunId, config, messageIds[1], "two", 200)
    await seedUnreadMessage(teamRunId, config, messageIds[2], "three", 300)

    const ackSpy = spyOn(ackModule, "ackMessages")
    const promptAsyncSpy = mock(async (_input: {
      path: { id: string }
      body: { parts: Array<{ type: "text"; text: string }> }
      query: { directory: string }
    }) => {
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "member-session" },
      },
    })

    // then
    expect(ackSpy).toHaveBeenCalledTimes(1)
    expect(ackSpy).toHaveBeenCalledWith(teamRunId, "worker", messageIds, config)
    expect(promptAsyncSpy).not.toHaveBeenCalled()

    const runtimeState = await loadRuntimeState(teamRunId, config)
    expect(runtimeState.members[0]?.pendingInjectedMessageIds).toEqual([])

    const inboxEntries = await readdir(getInboxDir(resolveBaseDir(config), teamRunId, "worker"))
    expect(inboxEntries).toContain("processed")

    const processedEntries = await readdir(path.join(getInboxDir(resolveBaseDir(config), teamRunId, "worker"), "processed"))
    expect(processedEntries.sort()).toEqual(messageIds.map((messageId) => `${messageId}.json`).sort())
  })

  test("sends a wake hint during the spawn race when the registry tracks the fresh member session before disk state persists it", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const teamRunId = randomUUID()
    const staleRuntimeState: RuntimeState = {
      ...createRuntimeState(teamRunId),
      members: [
        {
          name: "worker",
          agentType: "general-purpose",
          status: "idle",
          pendingInjectedMessageIds: [],
        },
      ],
    }
    await seedRuntimeState(staleRuntimeState, config)
    await seedUnreadMessage(teamRunId, config, randomUUID(), "fresh registry wake hint", 100)
    registerTeamSession("member-session", {
      teamRunId,
      memberName: "worker",
      role: "member",
    })

    const promptInputs: Array<WakeHintPromptInput> = []
    const promptAsyncSpy = mock(async (input: WakeHintPromptInput) => {
      promptInputs.push(input)
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "member-session" },
      },
    })

    // then
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1)
    const promptInput = promptInputs[0]
    if (promptInput === undefined) {
      throw new Error("expected wake hint prompt input")
    }
    expect(promptInput.body.parts[0]?.text).toContain("1 new team messages")
  })

  test("falls back to disk lookup when the registry points the member session at the wrong teamRunId", async () => {
    // given
    const baseDir = await createTemporaryBaseDir()
    const config = createConfig(baseDir)
    const correctTeamRunId = randomUUID()
    const wrongTeamRunId = randomUUID()
    const correctRuntimeState = createRuntimeState(correctTeamRunId)
    const correctWorker = correctRuntimeState.members[0]
    if (correctWorker === undefined) {
      throw new Error("worker member missing from correct fixture")
    }
    correctWorker.subagent_type = "atlas"
    await seedRuntimeState(correctRuntimeState, config)
    await seedRuntimeState({
      ...createRuntimeState(wrongTeamRunId),
      members: [
        {
          name: "worker",
          sessionId: "other-session",
          agentType: "general-purpose",
          status: "idle",
          pendingInjectedMessageIds: [],
        },
      ],
    }, config)
    await seedUnreadMessage(correctTeamRunId, config, randomUUID(), "first correct message", 100)
    await seedUnreadMessage(correctTeamRunId, config, randomUUID(), "second correct message", 200)
    await seedUnreadMessage(wrongTeamRunId, config, randomUUID(), "wrong team message", 300)
    registerTeamSession("member-session", {
      teamRunId: wrongTeamRunId,
      memberName: "worker",
      role: "member",
    })

    const promptInputs: Array<WakeHintPromptInput> = []
    const promptAsyncSpy = mock(async (input: WakeHintPromptInput) => {
      promptInputs.push(input)
      return {}
    })
    const handler = createTeamIdleWakeHint({
      directory: "/tmp/project",
      client: { session: { promptAsync: promptAsyncSpy } },
    }, config)

    // when
    await handler({
      event: {
        type: "session.idle",
        properties: { sessionID: "member-session" },
      },
    })

    // then
    expect(promptAsyncSpy).toHaveBeenCalledTimes(1)
    const promptInput = promptInputs[0]
    if (promptInput === undefined) {
      throw new Error("expected wake hint prompt input")
    }
    expect(promptInput.body.parts[0]?.text).toContain("2 new team messages")
    expect(promptInput.body.agent).toBe("atlas")
  })
})
