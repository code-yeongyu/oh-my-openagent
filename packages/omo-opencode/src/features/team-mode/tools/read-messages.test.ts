/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { createRuntimeState, saveRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import type { Message } from "@oh-my-opencode/team-core/types"
import { createTeamReadMessagesTool, defaultTeamReadMessagesToolDeps } from "./read-messages"

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

function makeMessage(overrides: Partial<Message> & { from: string; body: string }): Message {
  return {
    version: 1,
    messageId: randomUUID(),
    from: overrides.from,
    to: "team-lead",
    kind: "message",
    body: overrides.body,
    timestamp: overrides.timestamp ?? Date.now(),
    summary: overrides.summary,
    references: overrides.references,
    correlationId: overrides.correlationId,
    ...overrides,
  }
}

async function createFixture() {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-read-messages-"))
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
  const leadSessionId = randomUUID()
  const runtimeState = await createRuntimeState(
    {
      version: 1,
      name: "team-read",
      createdAt: Date.now(),
      leadAgentId: "team-lead",
      members: [
        { kind: "subagent_type", name: "team-lead", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
        { kind: "subagent_type", name: "m1", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
      ],
    },
    leadSessionId,
    "project",
    config,
  )
  runtimeState.leadSessionId = leadSessionId
  runtimeState.members[0].sessionId = leadSessionId
  await saveRuntimeState(runtimeState, config)
  return { config, baseDir, leadSessionId, teamRunId: runtimeState.teamRunId }
}

function parse(result: string | { output: string }): { member: string; count: number; markedRead: boolean; messages: Array<{ messageId: string; body: string }> } {
  return JSON.parse(typeof result === "string" ? result : result.output)
}

describe("createTeamReadMessagesTool", () => {
  test("#given unread messages in the lead inbox #when read #then returns bodies oldest-first and marks them read", async () => {
    // given
    const fx = await createFixture()
    const messages = [
      makeMessage({ from: "m1", body: "first finding", timestamp: 1000 }),
      makeMessage({ from: "m1", body: "second finding", timestamp: 2000 }),
    ]
    const ackCalls: Array<{ member: string; ids: string[] }> = []
    const tool = createTeamReadMessagesTool(fx.config, {
      ...defaultTeamReadMessagesToolDeps,
      listUnreadMessages: async () => messages,
      ackMessages: async (_teamRunId, member, ids) => {
        ackCalls.push({ member, ids })
      },
    })

    // when
    const result = parse(await tool.execute({ teamRunId: fx.teamRunId }, createToolContext(fx.leadSessionId, fx.baseDir)))

    // then
    expect(result.member).toBe("team-lead")
    expect(result.count).toBe(2)
    expect(result.markedRead).toBe(true)
    expect(result.messages.map((m) => m.body)).toEqual(["first finding", "second finding"])
    expect(ackCalls).toHaveLength(1)
    expect(ackCalls[0].member).toBe("team-lead")
    expect(ackCalls[0].ids).toEqual(messages.map((m) => m.messageId))
  })

  test("#given sinceId #when read #then returns only messages after it", async () => {
    // given
    const fx = await createFixture()
    const messages = [
      makeMessage({ from: "m1", body: "old", timestamp: 1000 }),
      makeMessage({ from: "m1", body: "new", timestamp: 2000 }),
    ]
    const tool = createTeamReadMessagesTool(fx.config, {
      ...defaultTeamReadMessagesToolDeps,
      listUnreadMessages: async () => messages,
      ackMessages: async () => {},
    })

    // when
    const result = parse(await tool.execute({ teamRunId: fx.teamRunId, sinceId: messages[0].messageId }, createToolContext(fx.leadSessionId, fx.baseDir)))

    // then
    expect(result.count).toBe(1)
    expect(result.messages[0].body).toBe("new")
  })

  test("#given mark_read false #when read #then does NOT ack (peek)", async () => {
    // given
    const fx = await createFixture()
    let acked = false
    const tool = createTeamReadMessagesTool(fx.config, {
      ...defaultTeamReadMessagesToolDeps,
      listUnreadMessages: async () => [makeMessage({ from: "m1", body: "peeked" })],
      ackMessages: async () => {
        acked = true
      },
    })

    // when
    const result = parse(await tool.execute({ teamRunId: fx.teamRunId, mark_read: false }, createToolContext(fx.leadSessionId, fx.baseDir)))

    // then
    expect(result.count).toBe(1)
    expect(result.markedRead).toBe(false)
    expect(acked).toBe(false)
  })

  test("#given empty inbox #when read #then count 0 and no ack", async () => {
    // given
    const fx = await createFixture()
    let acked = false
    const tool = createTeamReadMessagesTool(fx.config, {
      ...defaultTeamReadMessagesToolDeps,
      listUnreadMessages: async () => [],
      ackMessages: async () => {
        acked = true
      },
    })

    // when
    const result = parse(await tool.execute({ teamRunId: fx.teamRunId }, createToolContext(fx.leadSessionId, fx.baseDir)))

    // then
    expect(result.count).toBe(0)
    expect(acked).toBe(false)
  })
})
