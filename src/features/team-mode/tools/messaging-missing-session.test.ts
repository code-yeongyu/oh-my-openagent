/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdtemp, readdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import type { ToolContext } from "@opencode-ai/plugin/tool"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import type { RuntimeState } from "../types"
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

describe("createTeamSendMessageTool missing recipient session fallback", () => {
  test("releases the .delivering reservation when the recipient session disappears before live delivery", async () => {
    // given
    const baseDir = await mkdtemp(path.join(tmpdir(), "team-send-message-missing-session-"))
    const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
    const teamRunId = randomUUID()
    const leadSessionId = randomUUID()
    const memberOneSessionId = randomUUID()
    const memberTwoSessionId = randomUUID()

    const runtimeStateWithRecipientSession: RuntimeState = {
      version: 1,
      teamRunId,
      teamName: "team-alpha",
      specSource: "project",
      createdAt: Date.now(),
      leadSessionId,
      status: "active",
      shutdownRequests: [],
      bounds: {
        maxMembers: 8,
        maxParallelMembers: 4,
        maxMessagesPerRun: 10000,
        maxWallClockMinutes: 120,
        maxMemberTurns: 500,
      },
      members: [
        { name: "team-lead", agentType: "leader", status: "idle", sessionId: leadSessionId, pendingInjectedMessageIds: [] },
        { name: "m1", agentType: "general-purpose", status: "idle", sessionId: memberOneSessionId, pendingInjectedMessageIds: [] },
        { name: "m2", agentType: "general-purpose", status: "idle", sessionId: memberTwoSessionId, pendingInjectedMessageIds: [] },
      ],
    }
    const runtimeStateWithoutRecipientSession: RuntimeState = {
      ...runtimeStateWithRecipientSession,
      members: runtimeStateWithRecipientSession.members.map((member) => (
        member.name === "m2"
          ? { ...member, sessionId: undefined }
          : member
      )),
    }

    let loadRuntimeStateCalls = 0
    const deps = {
      loadRuntimeState: async () => {
        loadRuntimeStateCalls += 1
        return loadRuntimeStateCalls >= 3
          ? runtimeStateWithoutRecipientSession
          : runtimeStateWithRecipientSession
      },
    } satisfies NonNullable<Parameters<typeof createTeamSendMessageTool>[2]>

    const client = {
      session: {
        promptAsync: async () => {
          throw new Error("promptAsync should not run when the recipient session is missing")
        },
      },
    } satisfies LiveDeliveryClient
    const tool = createTeamSendMessageTool(config, client, deps)

    // when
    const result = await tool.execute({
      teamRunId,
      to: "m2",
      body: "ping",
    }, createToolContext(memberOneSessionId, baseDir))
    const parsedResult = JSON.parse(result) as { deliveredTo: string[]; messageId: string }
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m2")
    const inboxEntries = (await readdir(inboxDir)).filter((entry) => entry.endsWith(".json"))

    // then
    expect(parsedResult.deliveredTo).toEqual(["m2"])
    expect(inboxEntries).toEqual([`${parsedResult.messageId}.json`])
  })
})
