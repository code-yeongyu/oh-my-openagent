/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { ToolContext } from "@opencode-ai/plugin/tool"
import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { listUnreadMessages } from "@oh-my-opencode/team-core/team-mailbox/inbox"
import { createRuntimeState, saveRuntimeState } from "@oh-my-opencode/team-core/team-state-store/store"
import { aggregateStatus } from "../team-runtime/status"
import { createTeamSendMessageTool, type LiveDeliveryClient } from "./messaging"

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

async function createIdleMemberFixture() {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-send-message-wake-status-"))
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
  const leadSessionId = randomUUID()
  const senderSessionId = randomUUID()
  const recipientSessionId = randomUUID()

  const runtimeState = await createRuntimeState(
    {
      version: 1,
      name: "team-wake-status",
      createdAt: Date.now(),
      leadAgentId: "lead",
      members: [
        { kind: "subagent_type", name: "lead", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
        { kind: "subagent_type", name: "sender", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
        { kind: "subagent_type", name: "recipient", subagent_type: "sisyphus-junior", backendType: "in-process", isActive: true },
      ],
    },
    leadSessionId,
    "project",
    config,
  )

  await saveRuntimeState({
    ...runtimeState,
    leadSessionId,
    members: runtimeState.members.map((member) => {
      if (member.name === "lead") return { ...member, sessionId: leadSessionId, status: "idle" as const }
      if (member.name === "sender") return { ...member, sessionId: senderSessionId, status: "idle" as const }
      return { ...member, sessionId: recipientSessionId, status: "idle" as const }
    }),
  }, config)

  return {
    baseDir,
    config,
    teamRunId: runtimeState.teamRunId,
    senderSessionId,
    recipientSessionId,
  }
}

describe("team_send_message wake status", () => {
  test("#given an idle recipient session accepts a message wake #when team_send_message runs #then exactly one wake is pending in team status", async () => {
    // given
    const fixture = await createIdleMemberFixture()
    const calls: string[] = []
    const client = {
      session: {
        promptAsync: async (input) => {
          calls.push(input.path.id)
        },
      },
    } satisfies LiveDeliveryClient
    const tool = createTeamSendMessageTool(fixture.config, client)

    // when
    await tool.execute({
      teamRunId: fixture.teamRunId,
      to: "recipient",
      body: "wake once",
    }, createToolContext(fixture.senderSessionId, fixture.baseDir))
    const status = await aggregateStatus(fixture.teamRunId, fixture.config)

    // then
    expect(calls).toEqual([fixture.recipientSessionId])
    expect(status.members.find((member) => member.name === "recipient")?.wakeRequirement).toEqual({
      state: "pending",
      reason: "live delivery pending recipient acknowledgement",
      messageCount: 1,
    })
  })

  test("#given an idle recipient wake dispatch fails #when team_send_message falls back to inbox delivery #then team status exposes the wake error", async () => {
    // given
    const fixture = await createIdleMemberFixture()
    let promptCalls = 0
    const client = {
      session: {
        promptAsync: async () => {
          promptCalls += 1
          throw new Error("network down")
        },
      },
    } satisfies LiveDeliveryClient
    const tool = createTeamSendMessageTool(fixture.config, client)

    // when
    await tool.execute({
      teamRunId: fixture.teamRunId,
      to: "recipient",
      body: "wake failure should be visible",
    }, createToolContext(fixture.senderSessionId, fixture.baseDir))
    const unreadMessages = await listUnreadMessages(fixture.teamRunId, "recipient", fixture.config)
    const status = await aggregateStatus(fixture.teamRunId, fixture.config)

    // then
    expect(promptCalls).toBe(1)
    expect(unreadMessages).toHaveLength(1)
    expect(status.members.find((member) => member.name === "recipient")?.wakeRequirement).toEqual({
      state: "error",
      reason: "live delivery wake failed: network down",
      messageCount: 1,
    })
  })
})
