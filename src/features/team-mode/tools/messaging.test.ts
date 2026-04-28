/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readdir, readFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { type ToolContext } from "@opencode-ai/plugin/tool"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { _resetForTesting, registerAgentName } from "../../claude-code-session-state"
import { SessionCategoryRegistry } from "../../../shared/session-category-registry"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "../../../shared/session-prompt-params-state"
import { listUnreadMessages } from "../team-mailbox/inbox"
import { BroadcastNotPermittedError } from "../team-mailbox/send"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { createRuntimeState, saveRuntimeState } from "../team-state-store/store"
import { clearTeamSessionRegistry, registerTeamSession } from "../team-session-registry"
import type { Message } from "../types"
import { MessageSchema } from "../types"
import { createTeamSendMessageTool } from "./messaging"

type PromptAsyncCall = {
  sessionId: string
  parts: Array<{ type: string; text?: string }>
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  directory?: string
}

type LiveDeliveryClient = {
  session: {
    promptAsync(input: {
      path: { id: string }
      body: {
        parts: Array<{ type: "text"; text: string }>
        agent?: string
        model?: { providerID: string; modelID: string }
        variant?: string
      }
      query?: { directory: string }
    }): Promise<unknown>
  }
}

function createRecordingClient(): { client: LiveDeliveryClient; calls: PromptAsyncCall[] } {
  const calls: PromptAsyncCall[] = []
  const client = {
    session: {
      promptAsync: async (input: {
        path: { id: string }
        body: {
          parts: Array<{ type: "text"; text: string }>
          agent?: string
          model?: { providerID: string; modelID: string }
          variant?: string
        }
        query?: { directory: string }
      }) => {
        calls.push({
          sessionId: input.path.id,
          parts: input.body.parts,
          agent: input.body.agent,
          model: input.body.model,
          variant: input.body.variant,
          directory: input.query?.directory,
        })
        return undefined
      },
    },
  }
  return { client, calls }
}

const mockClient: LiveDeliveryClient = {
  session: {
    promptAsync: async () => { throw new Error("live delivery disabled in fixture") },
  },
}

afterEach(() => {
  clearTeamSessionRegistry()
  SessionCategoryRegistry.clear()
  clearAllSessionPromptParams()
  _resetForTesting()
})

async function createFixtureBaseDir(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-send-message-"))
}

function createConfig(baseDir: string) {
  return TeamModeConfigSchema.parse({ base_dir: baseDir })
}

function createToolContext(sessionID: string, directory: string): ToolContext {
  return {
    sessionID,
    messageID: randomUUID(),
    agent: "test-agent",
    directory,
    worktree: directory,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => undefined,
  }
}

async function createTeamFixture() {
  const baseDir = await createFixtureBaseDir()
  const config = createConfig(baseDir)
  const leadSessionId = randomUUID()
  const memberOneSessionId = randomUUID()
  const memberTwoSessionId = randomUUID()

  const runtimeState = await createRuntimeState(
    {
      version: 1,
      name: "team-alpha",
        createdAt: Date.now(),
        leadAgentId: "team-lead",
        members: [
          { kind: "subagent_type", name: "team-lead", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
          { kind: "subagent_type", name: "m1", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
          { kind: "subagent_type", name: "m2", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
        ],
      },
    leadSessionId,
    "project",
    config,
  )

  runtimeState.leadSessionId = leadSessionId
  runtimeState.members[0].sessionId = leadSessionId
  runtimeState.members[1].sessionId = memberOneSessionId
  runtimeState.members[2].sessionId = memberTwoSessionId
  runtimeState.members[0].status = "idle"
  runtimeState.members[1].status = "idle"
  runtimeState.members[2].status = "idle"
  await saveRuntimeState(runtimeState, config)

  return {
    config,
      teamRunId: runtimeState.teamRunId,
      leadSessionId,
      memberOneSessionId,
      memberTwoSessionId,
      tool: createTeamSendMessageTool(config, mockClient),
      toolContext: (sessionID: string) => createToolContext(sessionID, baseDir),
    }
}

describe("createTeamSendMessageTool", () => {
  test("routes a member message to one recipient", async () => {
    // given
    const fixture = await createTeamFixture()

    // when
    const result = await fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "hello",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const parsedResult = JSON.parse(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const [messageFile] = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    const message = MessageSchema.parse(JSON.parse(await readFile(path.join(inboxDir, messageFile), "utf8")))
    expect(message.from).toBe("m1")
  })

  test("gates broadcast to the lead and fans out to active members", async () => {
    // given
    const fixture = await createTeamFixture()

    // when
    const nonLeadResult = fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "*",
      body: "hello everyone",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(nonLeadResult).rejects.toBeInstanceOf(BroadcastNotPermittedError)

    // when
    const leadResult = await fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "*",
      body: "team announcement",
      kind: "announcement",
    }, fixture.toolContext(fixture.leadSessionId))
    const parsedLeadResult = JSON.parse(leadResult)

    // then
    expect(parsedLeadResult.deliveredTo).toEqual(["m1", "m2"])
    const memberOneInbox = await readdir(getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m1"))
    const memberTwoInbox = await readdir(getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2"))
    expect(memberOneInbox.filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))).toHaveLength(1)
    expect(memberTwoInbox.filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))).toHaveLength(1)
  })

  test("live-delivers the envelope via promptAsync to the recipient session", async () => {
    // given
    const fixture = await createTeamFixture()
    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0].sessionId).toBe(fixture.memberTwoSessionId)
    expect(calls[0].directory).toBe(resolveBaseDir(fixture.config))
    const envelopeText = calls[0].parts[0]?.text ?? ""
    expect(envelopeText).toContain("<peer_message")
    expect(envelopeText).toContain('from="m1"')
    expect(envelopeText).toContain("ping")
  })

  test("live delivery targets the recipient worktree when available", async () => {
    // given
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    const state = await loadState(fixture.teamRunId, fixture.config)
    const memberTwo = state.members.find((member) => member.name === "m2")
    if (!memberTwo) throw new Error("m2 runtime member missing")
    memberTwo.worktreePath = "/tmp/team-worker-m2"
    await saveState(state, fixture.config)

    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.directory).toBe("/tmp/team-worker-m2")
  })

  test("live-delivers to running recipients so active teammates receive messages immediately", async () => {
    // given
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    const state = await loadState(fixture.teamRunId, fixture.config)
    const memberTwo = state.members.find((member) => member.name === "m2")
    if (!memberTwo) throw new Error("m2 runtime member missing")
    memberTwo.status = "running"
    await saveState(state, fixture.config)

    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    const result = await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const parsedResult = JSON.parse(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.sessionId).toBe(fixture.memberTwoSessionId)
    expect(calls[0]?.directory).toBe(resolveBaseDir(fixture.config))
  })

  test("live delivery pins the recipient's resolved subagent_type and model on promptAsync", async () => {
    // given
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    const state = await loadState(fixture.teamRunId, fixture.config)
    const memberTwo = state.members.find((member) => member.name === "m2")
    if (!memberTwo) throw new Error("m2 runtime member missing")
    memberTwo.subagent_type = "atlas"
    memberTwo.model = { providerID: "anthropic", modelID: "claude-opus-4-7", variant: "high" }
    await saveState(state, fixture.config)

    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0].sessionId).toBe(fixture.memberTwoSessionId)
    expect(calls[0].agent).toBe("atlas")
    expect(calls[0].model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
    expect(calls[0].variant).toBe("high")
  })

  test("live delivery uses the registered agent alias when the runtime stores a config-key agent name", async () => {
    // given
    registerAgentName("\u200B\u200B\u200B\u200BAtlas - Plan Executor")
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    const state = await loadState(fixture.teamRunId, fixture.config)
    const memberTwo = state.members.find((member) => member.name === "m2")
    if (!memberTwo) throw new Error("m2 runtime member missing")
    memberTwo.subagent_type = "atlas"
    await saveState(state, fixture.config)

    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.agent).toBe("\u200B\u200B\u200B\u200BAtlas - Plan Executor")
  })

  test("live delivery reapplies category routing and advanced model params for category members", async () => {
    // given
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    const state = await loadState(fixture.teamRunId, fixture.config)
    const memberTwo = state.members.find((member) => member.name === "m2")
    if (!memberTwo) throw new Error("m2 runtime member missing")
    memberTwo.subagent_type = "Sisyphus-Junior"
    memberTwo.category = "quick"
    memberTwo.model = {
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "medium",
      reasoningEffort: "high",
      temperature: 0.2,
      top_p: 0.8,
      maxTokens: 4096,
      thinking: { type: "enabled", budgetTokens: 2048 },
    }
    await saveState(state, fixture.config)

    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0].agent).toBe("Sisyphus-Junior")
    expect(calls[0].model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(calls[0].variant).toBe("medium")
    expect(SessionCategoryRegistry.get(fixture.memberTwoSessionId)).toBe("quick")
    expect(getSessionPromptParams(fixture.memberTwoSessionId)).toEqual({
      temperature: 0.2,
      topP: 0.8,
      maxOutputTokens: 4096,
      options: {
        reasoningEffort: "high",
        thinking: { type: "enabled", budgetTokens: 2048 },
      },
    })
  })

  test("live delivery omits agent and model on promptAsync when the runtime member has none recorded", async () => {
    // given
    const fixture = await createTeamFixture()
    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0].agent).toBeUndefined()
    expect(calls[0].model).toBeUndefined()
    expect(calls[0].variant).toBeUndefined()
  })

  test("prefers the team session registry when the runtime member session has not been persisted yet", async () => {
    // given
    const fixture = await createTeamFixture()
    registerTeamSession(fixture.memberOneSessionId, {
      teamRunId: fixture.teamRunId,
      memberName: "m1",
      role: "member",
    })

    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    const runtimeState = await loadState(fixture.teamRunId, fixture.config)
    const memberOne = runtimeState.members.find((member) => member.name === "m1")
    if (!memberOne) throw new Error("m1 runtime member missing")
    memberOne.sessionId = undefined
    await saveState(runtimeState, fixture.config)

    // when
    const result = await fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "hello",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const parsedResult = JSON.parse(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const [messageFile] = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    const message = MessageSchema.parse(JSON.parse(await readFile(path.join(inboxDir, messageFile), "utf8")))
    expect(message.from).toBe("m1")
  })

  test("acks the message after live delivery so the transform hook does not redeliver", async () => {
    // given
    const fixture = await createTeamFixture()
    const { client } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    const processedEntries = (await readdir(path.join(inboxDir, "processed"))).filter((entry) => entry.endsWith(".json"))
    expect(inboxEntries).toHaveLength(0)
    expect(processedEntries).toHaveLength(1)
  })

  test("broadcast fans out live delivery to every member except the sender", async () => {
    // given
    const fixture = await createTeamFixture()
    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "*",
      body: "broadcast ping",
      kind: "announcement",
    }, fixture.toolContext(fixture.leadSessionId))

    // then
    const targetedSessionIds = calls.map((entry) => entry.sessionId).sort()
    expect(targetedSessionIds).toEqual([
      fixture.memberOneSessionId,
      fixture.memberTwoSessionId,
    ].sort())
  })

  test("broadcast still queues for members whose session has not spawned yet", async () => {
    // given
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState } = await import("../team-state-store/store")
    const stateBefore = await loadState(fixture.teamRunId, fixture.config)
    const pendingMember = stateBefore.members.find((member) => member.name === "m2")
    if (!pendingMember) throw new Error("m2 runtime member missing")
    pendingMember.sessionId = undefined
    await saveRuntimeState(stateBefore, fixture.config)

    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    const result = await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "*",
      body: "broadcast ping",
      kind: "announcement",
    }, fixture.toolContext(fixture.leadSessionId))
    const parsedResult = JSON.parse(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m1", "m2"])
    const targetedSessionIds = calls.map((entry) => entry.sessionId)
    expect(targetedSessionIds).toEqual([fixture.memberOneSessionId])
    const memberTwoInbox = await readdir(getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2"))
    expect(memberTwoInbox.filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))).toHaveLength(1)
  })

  test("inbox stays intact when live delivery fails so the fallback path still works", async () => {
    // given
    const fixture = await createTeamFixture()
    const failingClient = {
      session: {
        promptAsync: async () => { throw new Error("network down") },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, failingClient)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
    expect(inboxEntries).toHaveLength(1)
  })

  test("reserves the message during live delivery so concurrent listings cannot surface it", async () => {
    // given
    const fixture = await createTeamFixture()
    let unreadDuringDelivery: Message[] = []
    const reservingClient = {
      session: {
        promptAsync: async () => {
          unreadDuringDelivery = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
          return undefined
        },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, reservingClient)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(unreadDuringDelivery).toHaveLength(0)
  })

  test("hides the message from the inbox from the moment it is written for a live recipient", async () => {
    // given
    const fixture = await createTeamFixture()
    const { sendMessage } = await import("../team-mailbox/send")
    const messageId = randomUUID()

    // when
    await sendMessage({
      version: 1,
      messageId,
      from: "m1",
      to: "m2",
      kind: "message",
      body: "ping",
      timestamp: Date.now(),
    }, fixture.teamRunId, fixture.config, {
      isLead: false,
      activeMembers: ["m2"],
      reservedRecipients: new Set(["m2"]),
    })
    const unreadImmediately = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const rawEntries = (await readdir(inboxDir))
      .filter((entry) => entry.endsWith(".json"))

    // then
    expect(unreadImmediately).toHaveLength(0)
    expect(rawEntries).toEqual([`.delivering-${messageId}.json`])
  })

  test("rejects shutdown_request kind", async () => {
    // given
    const fixture = await createTeamFixture()

    // when
    const result = fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "m1",
      body: "stop",
      kind: "shutdown_request",
    }, fixture.toolContext(fixture.leadSessionId))

    // then
    expect(result).rejects.toBeInstanceOf(Error)
  })

  test("rejects a non-UUID correlationId before writing the message", async () => {
    // given
    const fixture = await createTeamFixture()

    // when
    const result = fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "hello",
      correlationId: "task-1",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    await expect(result).rejects.toThrow("correlationId")
    await expect(readdir(getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2"))).rejects.toThrow()
  })
})
