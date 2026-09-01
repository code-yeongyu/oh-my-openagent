/// <reference types="bun-types" />

import { afterEach, describe, expect, jest, spyOn, test } from "bun:test"
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import { type ToolContext, type ToolResult } from "@opencode-ai/plugin/tool"
import { z } from "zod"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { _resetForTesting, registerAgentName } from "../../claude-code-session-state"
import { SessionCategoryRegistry } from "../../../shared/session-category-registry"
import {
  clearAllSessionPromptParams,
  getSessionPromptParams,
} from "../../../shared/session-prompt-params-state"
import {
  DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS,
  dispatchInternalPrompt,
  releaseAllPromptAsyncReservationsForTesting,
  releasePromptAsyncReservation,
} from "../../../hooks/shared/prompt-async-gate"
import { DEFAULT_SESSION_IDLE_SETTLE_MS } from "@oh-my-opencode/utils/session-idle-settle"
import { ackMessages } from "@oh-my-opencode/team-core/team-mailbox/ack"
import { listUnreadMessages } from "@oh-my-opencode/team-core/team-mailbox/inbox"
import { pollAndBuildInjection } from "@oh-my-opencode/team-core/team-mailbox/poll"
import { BroadcastNotPermittedError } from "@oh-my-opencode/team-core/team-mailbox/send"
import { getInboxDir, resolveBaseDir } from "@oh-my-opencode/team-core/team-registry/paths"
import { createRuntimeState, loadRuntimeState, saveRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import { clearTeamSessionRegistry, registerTeamSession } from "../team-session-registry"
import type { Message } from "@oh-my-opencode/team-core/types"
import { MessageSchema } from "@oh-my-opencode/team-core/types"
import { createTeamIdleWakeHint } from "../../../hooks/team-session-events/team-idle-wake-hint"
import { createTeamSendMessageTool as createProductionTeamSendMessageTool } from "./messaging"
import { defaultTeamSendMessageToolDeps, resolveTeamRuntimeDetails } from "./messaging-runtime"

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

const TeamSendToolResultSchema = z.object({
  messageId: z.string(),
  deliveredTo: z.array(z.string()),
}).strict()

type TeamSendToolResult = z.infer<typeof TeamSendToolResultSchema>

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
}

const temporaryDirectories: string[] = []
const TEST_EVENT_TIMEOUT_MS = 3_000
const realSetTimeout = globalThis.setTimeout
const realClearTimeout = globalThis.clearTimeout

function createTeamSendMessageTool(
  config: Parameters<typeof createProductionTeamSendMessageTool>[0],
  client: Parameters<typeof createProductionTeamSendMessageTool>[1],
  deps: Parameters<typeof createProductionTeamSendMessageTool>[2] = defaultTeamSendMessageToolDeps,
): ReturnType<typeof createProductionTeamSendMessageTool> {
  return createProductionTeamSendMessageTool(config, client, {
    ...defaultTeamSendMessageToolDeps,
    ...deps,
    liveDeliverySettleMs: 0,
  })
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: Deferred<T>["resolve"] | undefined
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve
  })
  if (!resolvePromise) throw new Error("deferred resolver was not initialized")
  return { promise, resolve: resolvePromise }
}

async function waitForEvent<T>(
  promise: Promise<T>,
  description: string,
  timeoutMs = TEST_EVENT_TIMEOUT_MS,
): Promise<T> {
  let timeoutID: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutID = realSetTimeout(() => reject(new Error(`timed out waiting for ${description}`)), timeoutMs)
  })

  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timeoutID !== undefined) {
      realClearTimeout(timeoutID)
    }
  }
}

afterEach(async () => {
  jest.useRealTimers()
  clearTeamSessionRegistry()
  SessionCategoryRegistry.clear()
  clearAllSessionPromptParams()
  releaseAllPromptAsyncReservationsForTesting()
  _resetForTesting()
  await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
    await rm(directoryPath, { recursive: true, force: true })
  }))
})

async function createFixtureBaseDir(): Promise<string> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-send-message-"))
  temporaryDirectories.push(baseDir)
  return baseDir
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

function parseToolResult(result: string | ToolResult): TeamSendToolResult {
  return TeamSendToolResultSchema.parse(JSON.parse(typeof result === "string" ? result : result.output))
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
  runtimeState.status = "active"
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
  test("resolveTeamRuntimeDetails preserves Error fallback for missing runtime state", async () => {
    // given
    const config = createConfig(await createFixtureBaseDir())

    // when
    const runtimeDetails = await resolveTeamRuntimeDetails("team-run-missing", "session-missing", config, {
      loadRuntimeState: async () => {
        throw new Error("missing runtime state")
      },
    })

    // then
    expect(runtimeDetails).toEqual({
      teamRunId: "team-run-missing",
      isLead: false,
      senderName: "unknown",
      activeMembers: [],
    })
  })

  test("resolveTeamRuntimeDetails preserves fallback for non-Error runtime load failures", async () => {
    // given
    const config = createConfig(await createFixtureBaseDir())
    const thrownValue = "missing runtime state"

    // when
    const runtimeDetails = await resolveTeamRuntimeDetails("team-run-missing", "session-missing", config, {
      loadRuntimeState: async () => {
        throw thrownValue
      },
    })

    // then
    expect(runtimeDetails).toEqual({
      teamRunId: "team-run-missing",
      isLead: false,
      senderName: "unknown",
      activeMembers: [],
    })
  })

  test("routes a member message to one recipient", async () => {
    // given
    const fixture = await createTeamFixture()

    // when
    const result = await fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "hello",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const parsedResult = parseToolResult(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const [messageFile] = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    const message = MessageSchema.parse(JSON.parse(await readFile(path.join(inboxDir, messageFile), "utf8")))
    expect(message.from).toBe("m1")
  })

  test("#given recipient tries path traversal #when team_send_message runs #then it rejects without creating an escaped inbox", async () => {
    // given
    const fixture = await createTeamFixture()
    const escapedInboxRoot = path.join(resolveBaseDir(fixture.config), "runtime", "escape")

    // when
    const result = fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "../../escape",
      body: "escape attempt",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    await expect(result).rejects.toThrow("unknown or inactive team recipient")
    await expect(readdir(escapedInboxRoot)).rejects.toThrow()
  })

  test("treats a host-injected empty correlationId as omitted", async () => {
    // given
    const fixture = await createTeamFixture()

    // when
    const result = await fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "hello without metadata",
      correlationId: "",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const parsedResult = parseToolResult(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const [messageFile] = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    const message = MessageSchema.parse(JSON.parse(await readFile(path.join(inboxDir, messageFile), "utf8")))
    expect(message.correlationId).toBeUndefined()
  })

  test("persists optional message metadata from tool arguments", async () => {
    // given
    const fixture = await createTeamFixture()
    const correlationId = randomUUID()

    // when
    const result = await fixture.tool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "hello with metadata",
      correlationId,
      summary: "metadata summary",
      references: [{ path: "src/features/team-mode/tools/messaging.ts", description: "send tool" }],
    }, fixture.toolContext(fixture.memberOneSessionId))
    const parsedResult = parseToolResult(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const [messageFile] = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    const message = MessageSchema.parse(JSON.parse(await readFile(path.join(inboxDir, messageFile), "utf8")))
    expect(message.kind).toBe("message")
    expect(message.correlationId).toBe(correlationId)
    expect(message.summary).toBe("metadata summary")
    expect(message.references).toEqual([
      { path: "src/features/team-mode/tools/messaging.ts", description: "send tool" },
    ])
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
    const parsedLeadResult = parseToolResult(leadResult)

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

  test("#given runtime marks recipient running #when team_send_message sends a peer message #then it leaves the unread mailbox path without promptAsync", async () => {
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
    const parsedResult = parseToolResult(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    expect(calls).toHaveLength(0)
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(1)
    expect(unread[0]?.body).toBe("ping")
    const inboxEntries = await readdir(getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2"))
    expect(inboxEntries.filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))).toHaveLength(1)
    expect(inboxEntries.some((entry) => entry.startsWith(".delivering-"))).toBe(false)
  })

  test("#given recipient OpenCode session is busy #when team_send_message attempts live delivery #then it releases the message for later mailbox injection", async () => {
    // given
    const fixture = await createTeamFixture()
    let promptCalls = 0
    const client = {
      session: {
        status: async () => ({ data: { [fixture.memberTwoSessionId]: { type: "busy" } } }),
        promptAsync: async () => {
          promptCalls += 1
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping while busy",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(promptCalls).toBe(0)
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(1)
    expect(unread[0]?.body).toBe("ping while busy")
  })

  test("#given rapid live deliveries to one recipient #when the first prompt just dispatched #then the next message queues a mailbox wake", async () => {
    // given
    const fixture = await createTeamFixture()
    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "first ping",
    }, fixture.toolContext(fixture.memberOneSessionId))
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "second ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.parts[0]?.text).toContain("first ping")
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(1)
    expect(unread[0]?.body).toBe("second ping")
  })

  test("#given live delivery falls back for an idle recipient #when the prompt gate clears #then a queued wake exposes the unread message", async () => {
    // given
    const fixture = await createTeamFixture()
    const fallbackWakeDispatched = createDeferred<void>()
    let promptCalls = 0
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          if (promptCalls === 2) fallbackWakeDispatched.resolve(undefined)
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-blocker",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "blocker" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "fallback ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    expect(promptCalls).toBe(1)
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread.map((message) => message.body)).toEqual(["fallback ping"])

    // when
    expect(releasePromptAsyncReservation(fixture.memberTwoSessionId, "test-blocker")).toBe(true)
    await waitForEvent(fallbackWakeDispatched.promise, "queued fallback mailbox wake")
    const injection = await pollAndBuildInjection(
      fixture.memberTwoSessionId,
      "m2",
      fixture.teamRunId,
      fixture.config,
      "turn-after-fallback-wake",
    )

    // then
    expect(promptCalls).toBe(2)
    expect(injection.injected).toBe(true)
    expect(injection.content).toContain("fallback ping")
  })

  test("#given a message waits behind pending live delivery #when that prompt clears #then a queued wake exposes the waiting message", async () => {
    // given
    const fixture = await createTeamFixture()
    const fallbackWakeDispatched = createDeferred<void>()
    let currentTime = Date.now()
    const dateNowSpy = spyOn(Date, "now").mockImplementation(() => currentTime)
    let promptCalls = 0
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          if (promptCalls === 2) fallbackWakeDispatched.resolve(undefined)
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    try {
      await liveTool.execute({
        teamRunId: fixture.teamRunId,
        to: "m2",
        body: "live ping",
      }, fixture.toolContext(fixture.memberOneSessionId))
      await liveTool.execute({
        teamRunId: fixture.teamRunId,
        to: "m2",
        body: "waiting ping",
      }, fixture.toolContext(fixture.memberOneSessionId))

      expect(promptCalls).toBe(1)
      const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
      expect(unread.map((message) => message.body)).toEqual(["waiting ping"])

      // when
      currentTime += DEFAULT_PROMPT_ASYNC_POST_DISPATCH_HOLD_MS
      await waitForEvent(fallbackWakeDispatched.promise, "pending-delivery fallback mailbox wake")
      const injection = await pollAndBuildInjection(
        fixture.memberTwoSessionId,
        "m2",
        fixture.teamRunId,
        fixture.config,
        "turn-after-pending-fallback-wake",
      )

      // then
      expect(promptCalls).toBe(2)
      expect(injection.injected).toBe(true)
      expect(injection.content).toContain("waiting ping")
    } finally {
      dateNowSpy.mockRestore()
    }
  })

  test("#given a queued fallback message was already injected #when the prompt gate clears #then the obsolete wake is cancelled", async () => {
    // given
    const fixture = await createTeamFixture()
    const probeDispatched = createDeferred<void>()
    const promptTexts: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text?: string }> } }) => {
          const text = input.body.parts[0]?.text ?? ""
          promptTexts.push(text)
          if (text === "queue probe") probeDispatched.resolve(undefined)
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-blocker",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "blocker" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "already injected",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const injection = await pollAndBuildInjection(
      fixture.memberTwoSessionId,
      "m2",
      fixture.teamRunId,
      fixture.config,
      "turn-before-fallback-wake",
    )
    expect(injection.injected).toBe(true)
    expect(injection.content).toContain("already injected")
    await ackMessages(fixture.teamRunId, "m2", injection.messageIds, fixture.config)

    const probeResult = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-probe",
      queueBehavior: "enqueue",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "queue probe" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    expect(probeResult.status).toBe("queued")

    // when
    expect(releasePromptAsyncReservation(fixture.memberTwoSessionId, "test-blocker")).toBe(true)
    await waitForEvent(probeDispatched.promise, "queue probe after cancelled fallback wake")

    // then
    expect(promptTexts).toEqual(["blocker", "queue probe"])
  })

  test("#given a queued fallback message is pending acknowledgement #when the prompt gate clears #then the obsolete wake is cancelled", async () => {
    // given
    const fixture = await createTeamFixture()
    const probeDispatched = createDeferred<void>()
    const promptTexts: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text?: string }> } }) => {
          const text = input.body.parts[0]?.text ?? ""
          promptTexts.push(text)
          if (text === "pending-ack queue probe") probeDispatched.resolve(undefined)
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-blocker",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "blocker" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "pending acknowledgement",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const injection = await pollAndBuildInjection(
      fixture.memberTwoSessionId,
      "m2",
      fixture.teamRunId,
      fixture.config,
      "turn-with-pending-ack",
    )
    expect(injection.injected).toBe(true)

    const probeResult = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-pending-ack-probe",
      queueBehavior: "enqueue",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "pending-ack queue probe" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    expect(probeResult.status).toBe("queued")

    // when
    expect(releasePromptAsyncReservation(fixture.memberTwoSessionId, "test-blocker")).toBe(true)
    await waitForEvent(probeDispatched.promise, "queue probe after pending acknowledgement")

    // then
    expect(promptTexts).toEqual(["blocker", "pending-ack queue probe"])
  })

  test("#given generic fallback wakes cover two messages #when the first is acknowledged #then the second message still wakes", async () => {
    // given
    const fixture = await createTeamFixture()
    const secondWakeDispatched = createDeferred<void>()
    const promptTexts: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text?: string }> } }) => {
          const text = input.body.parts[0]?.text ?? ""
          promptTexts.push(text)
          if (text.includes("You have a new team message")) secondWakeDispatched.resolve(undefined)
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-blocker",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "blocker" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "first fallback",
    }, fixture.toolContext(fixture.memberOneSessionId))
    const firstInjection = await pollAndBuildInjection(
      fixture.memberTwoSessionId,
      "m2",
      fixture.teamRunId,
      fixture.config,
      "turn-before-second-message",
    )
    expect(firstInjection.injected).toBe(true)

    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "second fallback",
    }, fixture.toolContext(fixture.memberOneSessionId))
    await ackMessages(fixture.teamRunId, "m2", firstInjection.messageIds, fixture.config)
    const unreadBeforeWake = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unreadBeforeWake.map((message) => message.body)).toEqual(["second fallback"])

    // when
    expect(releasePromptAsyncReservation(fixture.memberTwoSessionId, "test-blocker")).toBe(true)
    await waitForEvent(secondWakeDispatched.promise, "second message fallback wake")
    const secondInjection = await pollAndBuildInjection(
      fixture.memberTwoSessionId,
      "m2",
      fixture.teamRunId,
      fixture.config,
      "turn-after-second-message",
    )

    // then
    expect(promptTexts).toHaveLength(2)
    expect(secondInjection.injected).toBe(true)
    expect(secondInjection.content).toContain("second fallback")
  })

  test("#given a queued fallback recipient shut down #when the prompt gate clears #then the obsolete wake is cancelled", async () => {
    // given
    const fixture = await createTeamFixture()
    const probeDispatched = createDeferred<void>()
    const promptTexts: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text?: string }> } }) => {
          const text = input.body.parts[0]?.text ?? ""
          promptTexts.push(text)
          if (text === "shutdown queue probe") probeDispatched.resolve(undefined)
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-blocker",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "blocker" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "unread after shutdown",
    }, fixture.toolContext(fixture.memberOneSessionId))

    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    const runtimeState = await loadState(fixture.teamRunId, fixture.config)
    const recipient = runtimeState.members.find((member) => member.name === "m2")
    if (!recipient) throw new Error("m2 runtime member missing")
    recipient.status = "shutdown_approved"
    await saveState(runtimeState, fixture.config)

    const probeResult = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-shutdown-probe",
      queueBehavior: "enqueue",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "shutdown queue probe" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    expect(probeResult.status).toBe("queued")

    // when
    expect(releasePromptAsyncReservation(fixture.memberTwoSessionId, "test-blocker")).toBe(true)
    await waitForEvent(probeDispatched.promise, "queue probe after recipient shutdown")

    // then
    expect(promptTexts).toEqual(["blocker", "shutdown queue probe"])
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread.map((message) => message.body)).toEqual(["unread after shutdown"])
  })

  test("#given a queued fallback team was deleted #when the prompt gate clears #then the obsolete wake is cancelled", async () => {
    // given
    const fixture = await createTeamFixture()
    const probeDispatched = createDeferred<void>()
    const promptTexts: string[] = []
    const client = {
      session: {
        promptAsync: async (input: { body: { parts: Array<{ text?: string }> } }) => {
          const text = input.body.parts[0]?.text ?? ""
          promptTexts.push(text)
          if (text === "deleted-team queue probe") probeDispatched.resolve(undefined)
        },
      },
    }
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-blocker",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "blocker" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "unread before deletion",
    }, fixture.toolContext(fixture.memberOneSessionId))
    await rm(path.join(resolveBaseDir(fixture.config), "runtime", fixture.teamRunId), {
      recursive: true,
      force: true,
    })

    const probeResult = await dispatchInternalPrompt({
      mode: "async",
      client,
      sessionID: fixture.memberTwoSessionId,
      source: "test-deleted-team-probe",
      queueBehavior: "enqueue",
      input: {
        path: { id: fixture.memberTwoSessionId },
        body: { parts: [{ type: "text", text: "deleted-team queue probe" }] },
        query: { directory: resolveBaseDir(fixture.config) },
      },
    })
    expect(probeResult.status).toBe("queued")

    // when
    expect(releasePromptAsyncReservation(fixture.memberTwoSessionId, "test-blocker")).toBe(true)
    await waitForEvent(probeDispatched.promise, "queue probe after team deletion")

    // then
    expect(promptTexts).toEqual(["blocker", "deleted-team queue probe"])
  })

  test("#given live delivery queued a rapid-message wake #when recipient idle fires immediately #then the idle hint does not start a third reply", async () => {
    // given
    const fixture = await createTeamFixture()
    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "first ping",
    }, fixture.toolContext(fixture.memberOneSessionId))
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "second ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    const wakeHint = createTeamIdleWakeHint({
      directory: resolveBaseDir(fixture.config),
      client,
    }, fixture.config, { idleSettleMs: 0 })

    // when
    await wakeHint({
      event: {
        type: "session.idle",
        properties: { sessionID: fixture.memberTwoSessionId },
      },
    })

    // then
    expect(calls).toHaveLength(1)
    expect(calls[0]?.parts[0]?.text).toContain("first ping")
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(1)
    expect(unread[0]?.body).toBe("second ping")
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

  test("live delivery uses the ambient idle-settle default when no settle value is injected", async () => {
    const settleTimerScheduled = createDeferred<void>()
    const acceleratedSetTimeout = new Proxy(realSetTimeout, {
      apply(target, thisArg, args) {
        if (args[1] === DEFAULT_SESSION_IDLE_SETTLE_MS) {
          settleTimerScheduled.resolve(undefined)
          args[1] = 0
        }
        return Reflect.apply(target, thisArg, args)
      },
    })
    const setTimeoutSpy = spyOn(globalThis, "setTimeout").mockImplementation(acceleratedSetTimeout)

    try {
      // given
      const fixture = await createTeamFixture()
      const { client, calls } = createRecordingClient()
      const liveTool = createProductionTeamSendMessageTool(
        fixture.config,
        client,
        defaultTeamSendMessageToolDeps,
      )

      // when
      const delivery = liveTool.execute({
        teamRunId: fixture.teamRunId,
        to: "m2",
        body: "ambient default ping",
      }, fixture.toolContext(fixture.memberOneSessionId))
      await waitForEvent(settleTimerScheduled.promise, "live delivery idle-settle timer")
      await delivery

      // then
      expect(calls).toHaveLength(1)
      expect(calls[0]?.parts[0]?.text).toContain("ambient default ping")
    } finally {
      setTimeoutSpy.mockRestore()
    }
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
    const parsedResult = parseToolResult(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const [messageFile] = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    const message = MessageSchema.parse(JSON.parse(await readFile(path.join(inboxDir, messageFile), "utf8")))
    expect(message.from).toBe("m1")
  })

  test("keeps live-delivered messages reserved until the recipient idles", async () => {
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
    expect(inboxEntries).toHaveLength(1)
    expect(inboxEntries[0]?.startsWith(".delivering-")).toBe(true)

    const { loadRuntimeState: loadState } = await import("../team-state-store/store")
    const runtimeState = await loadState(fixture.teamRunId, fixture.config)
    const recipient = runtimeState.members.find((member) => member.name === "m2")
    expect(recipient?.pendingInjectedMessageIds).toHaveLength(1)
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
    const parsedResult = parseToolResult(result)

    // then
    expect(parsedResult.deliveredTo).toEqual(["m1", "m2"])
    const targetedSessionIds = calls.map((entry) => entry.sessionId)
    expect(targetedSessionIds).toEqual([fixture.memberOneSessionId])
    const memberTwoInbox = await readdir(getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2"))
    expect(memberTwoInbox.filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))).toHaveLength(1)
  })

  test("#given fallback wake fails ambiguously #when live delivery falls back #then it does not retry a possibly accepted request", async () => {
    // given
    const fixture = await createTeamFixture()
    let promptCalls = 0
    const failingClient = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          throw new TypeError("fetch failed")
        },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, failingClient)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "non-retryable ping",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(promptCalls).toBe(1)
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
    expect(inboxEntries).toHaveLength(1)
  })

  test("inbox stays intact when live delivery fails so the fallback path still works", async () => {
    // given
    const fixture = await createTeamFixture()
    const fallbackDispatched = createDeferred<void>()
    let promptCalls = 0
    const failingClient = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          if (promptCalls < 5) {
            const code = promptCalls % 2 === 0 ? "EHOSTUNREACH" : "ENETUNREACH"
            throw Object.assign(new Error(`connect ${code}`), { code })
          }
          fallbackDispatched.resolve(undefined)
        },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, failingClient)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ping",
    }, fixture.toolContext(fixture.memberOneSessionId))
    await waitForEvent(
      fallbackDispatched.promise,
      "fallback wake after pre-send transport failure",
      12_000,
    )
    const injection = await pollAndBuildInjection(
      fixture.memberTwoSessionId,
      "m2",
      fixture.teamRunId,
      fixture.config,
      "turn-after-transport-retry",
    )

    // then
    expect(promptCalls).toBe(5)
    expect(injection.injected).toBe(true)
    expect(injection.content).toContain("ping")
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))
    expect(inboxEntries).toHaveLength(1)
  }, 15_000)

  test("#given live delivery promptAsync fails ambiguously #when delivery handles the accepted-like failure #then it marks pending without inbox retry", async () => {
    // given
    const fixture = await createTeamFixture()
    let promptCalls = 0
    const failingClient = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          throw new Error("JSON Parse error: Unexpected EOF")
        },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, failingClient, {
      loadRuntimeState,
      liveDeliverySettleMs: 0,
    })

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "maybe already accepted",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(promptCalls).toBe(1)
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(0)

    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    expect(inboxEntries).toHaveLength(1)
    expect(inboxEntries[0]?.startsWith(".delivering-")).toBe(true)

    const { loadRuntimeState: loadState } = await import("../team-state-store/store")
    const runtimeState = await loadState(fixture.teamRunId, fixture.config)
    const recipient = runtimeState.members.find((member) => member.name === "m2")
    expect(recipient?.pendingInjectedMessageIds).toHaveLength(1)
  })

  test("#given dispatchInternalPrompt fails ambiguously #when pending mark fails #then the reservation is committed to processed", async () => {
    // given
    const fixture = await createTeamFixture()
    const failingClient = {
      session: {
        promptAsync: async () => {
          await rm(path.join(resolveBaseDir(fixture.config), "runtime", fixture.teamRunId, "state.json"))
          throw new Error("JSON Parse error: Unexpected EOF")
        },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, failingClient)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "ambiguous failure should retry",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(0)

    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = await readdir(inboxDir)
    expect(inboxEntries.filter((entry) => entry.startsWith(".delivering-"))).toHaveLength(0)
    const processedEntries = (await readdir(path.join(inboxDir, "processed"))).filter((entry) => entry.endsWith(".json"))
    expect(processedEntries).toHaveLength(1)
  })

  test("#given live delivery prompt dispatches but pending mark fails #when delivery finishes #then the reservation is committed to processed", async () => {
    // given
    const fixture = await createTeamFixture()
    let promptCalls = 0
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          await rm(path.join(resolveBaseDir(fixture.config), "runtime", fixture.teamRunId, "state.json"))
        },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "accepted before state vanished",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(promptCalls).toBe(1)
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(0)

    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))
    expect(inboxEntries.filter((entry) => entry.startsWith(".delivering-"))).toHaveLength(0)
    const processedEntries = (await readdir(path.join(inboxDir, "processed"))).filter((entry) => entry.endsWith(".json"))
    expect(processedEntries).toHaveLength(1)
  })

  test("#given dispatchInternalPrompt succeeds #when markLiveDeliveryPending fails #then the reservation is committed to processed/", async () => {
    // given
    const fixture = await createTeamFixture()
    const client = {
      session: {
        promptAsync: async () => {
          await rm(path.join(resolveBaseDir(fixture.config), "runtime", fixture.teamRunId, "state.json"))
        },
      },
    } satisfies LiveDeliveryClient
    const liveTool = createTeamSendMessageTool(fixture.config, client)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "accepted prompt should be processed",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    const inboxDir = getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2")
    const inboxEntries = await readdir(inboxDir)
    expect(inboxEntries.filter((entry) => entry.startsWith(".delivering-"))).toHaveLength(0)

    const processedEntries = (await readdir(path.join(inboxDir, "processed"))).filter((entry) => entry.endsWith(".json"))
    expect(processedEntries).toHaveLength(1)

    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(0)
  })

  test("#given live delivery cannot reload runtime after pre-reserve #when delivery aborts #then the message is released for mailbox injection", async () => {
    // given
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState } = await import("../team-state-store/store")
    const runtimeState = await loadState(fixture.teamRunId, fixture.config)
    let loadCount = 0
    const deps = {
      loadRuntimeState: async () => {
        loadCount += 1
        if (loadCount === 3) {
          throw new Error("runtime reload failed")
        }
        return runtimeState
      },
    }
    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client, deps)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "fallback unread",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(calls).toHaveLength(0)
    const unread = await listUnreadMessages(fixture.teamRunId, "m2", fixture.config)
    expect(unread).toHaveLength(1)
    expect(unread[0]?.body).toBe("fallback unread")

    const inboxEntries = await readdir(getInboxDir(resolveBaseDir(fixture.config), fixture.teamRunId, "m2"))
    expect(inboxEntries.filter((entry) => entry.endsWith(".json") && !entry.startsWith("."))).toHaveLength(1)
    expect(inboxEntries.some((entry) => entry.startsWith(".delivering-"))).toBe(false)
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

  test("#given transform already listed a peer message while recipient becomes idle #when live delivery races it #then only the live prompt receives the message", async () => {
    // given
    const fixture = await createTeamFixture()
    const { loadRuntimeState: loadState, saveRuntimeState: saveState } = await import("../team-state-store/store")
    let loadCount = 0
    let transformResult: Awaited<ReturnType<typeof pollAndBuildInjection>> | undefined
    const deps = {
      loadRuntimeState: async (teamRunId: string) => {
        loadCount += 1
        const state = await loadState(teamRunId, fixture.config)
        if (loadCount === 2) {
          return {
            ...state,
            members: state.members.map((member) => (
              member.name === "m2"
                ? { ...member, status: "running" as const, pendingInjectedMessageIds: [] }
                : member
            )),
          }
        }
        if (loadCount === 3) {
          const staleIdleSnapshot = {
            ...state,
            members: state.members.map((member) => (
              member.name === "m2"
                ? { ...member, status: "idle" as const, pendingInjectedMessageIds: [] }
                : member
            )),
          }
          await saveState(staleIdleSnapshot, fixture.config)
          transformResult = await pollAndBuildInjection(
            fixture.memberTwoSessionId,
            "m2",
            fixture.teamRunId,
            fixture.config,
            "turn-race",
          )
          return staleIdleSnapshot
        }
        return state
      },
    }
    const { client, calls } = createRecordingClient()
    const liveTool = createTeamSendMessageTool(fixture.config, client, deps)

    // when
    await liveTool.execute({
      teamRunId: fixture.teamRunId,
      to: "m2",
      body: "race payload",
    }, fixture.toolContext(fixture.memberOneSessionId))

    // then
    expect(transformResult).toEqual({
      injected: false,
      messageIds: [],
      reason: "no unread",
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.parts[0]?.text).toContain("race payload")
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
