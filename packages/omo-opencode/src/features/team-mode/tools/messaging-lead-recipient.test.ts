/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import type { ToolContext } from "@opencode-ai/plugin/tool"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { RuntimeState } from "@oh-my-opencode/team-core/types"
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

describe("createTeamSendMessageTool lead sentinel", () => {
  async function sendToLead(members: RuntimeState["members"], leadSessionId: string, callerSessionId: string) {
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-send-message-lead-"))
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const teamRunId = randomUUID()
    const runtimeState: RuntimeState = {
      version: 1,
      teamRunId,
      teamName: "team-alpha",
      specSource: "project",
      createdAt: Date.now(),
      leadSessionId,
      status: "active",
      shutdownRequests: [],
      bounds: { maxMembers: 8, maxParallelMembers: 4, maxMessagesPerRun: 10000, maxWallClockMinutes: 120, maxMemberTurns: 500 },
      members,
    }
    const deps = { loadRuntimeState: async () => runtimeState } satisfies NonNullable<Parameters<typeof createTeamSendMessageTool>[2]>
    const client = { session: { promptAsync: async () => undefined } } satisfies LiveDeliveryClient
    const tool = createTeamSendMessageTool(config, client, deps)

    const result = await tool.execute({ teamRunId, to: "lead", body: "ping" }, createToolContext(callerSessionId, baseDir))
    const parsed = JSON.parse(result) as { deliveredTo: string[] }
    return { parsed }
  }

  test("falls back to the first member when leadSessionId matches no member and none is typed leader", async () => {
    // given
    const memberOneSessionId = randomUUID()
    const members: RuntimeState["members"] = [
      { name: "creator", agentType: "general-purpose", status: "idle", sessionId: randomUUID(), pendingInjectedMessageIds: [] },
      { name: "m1", agentType: "general-purpose", status: "idle", sessionId: memberOneSessionId, pendingInjectedMessageIds: [] },
    ]

    // when
    const { parsed } = await sendToLead(members, randomUUID(), memberOneSessionId)

    // then
    expect(parsed.deliveredTo).toEqual(["creator"])
  })

  test("prefers the member bound to leadSessionId over the first member", async () => {
    // given
    const leadSessionId = randomUUID()
    const memberOneSessionId = randomUUID()
    const members: RuntimeState["members"] = [
      { name: "m0", agentType: "general-purpose", status: "idle", sessionId: randomUUID(), pendingInjectedMessageIds: [] },
      { name: "boss", agentType: "general-purpose", status: "idle", sessionId: leadSessionId, pendingInjectedMessageIds: [] },
      { name: "m1", agentType: "general-purpose", status: "idle", sessionId: memberOneSessionId, pendingInjectedMessageIds: [] },
    ]

    // when
    const { parsed } = await sendToLead(members, leadSessionId, memberOneSessionId)

    // then
    expect(parsed.deliveredTo).toEqual(["boss"])
  })
})
