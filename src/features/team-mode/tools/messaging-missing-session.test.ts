/// <reference types="bun-types" />

import { describe, expect, mock, test } from "bun:test"
import { mkdtemp, readdir } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"

import type { ToolContext } from "@opencode-ai/plugin/tool"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"

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

    const runtimeStateWithRecipientSession = {
      teamRunId,
      leadSessionId,
      status: "active",
      members: [
        { name: "team-lead", agentType: "leader", sessionId: leadSessionId },
        { name: "m1", agentType: "member", sessionId: memberOneSessionId },
        { name: "m2", agentType: "member", sessionId: memberTwoSessionId },
      ],
    }
    const runtimeStateWithoutRecipientSession = {
      ...runtimeStateWithRecipientSession,
      members: runtimeStateWithRecipientSession.members.map((member) => (
        member.name === "m2"
          ? { ...member, sessionId: undefined }
          : member
      )),
    }

    let loadRuntimeStateCalls = 0
    mock.module("../team-state-store/store", () => ({
      listActiveTeams: async () => [{ teamRunId }],
      loadRuntimeState: async () => {
        loadRuntimeStateCalls += 1
        return loadRuntimeStateCalls >= 3
          ? runtimeStateWithoutRecipientSession
          : runtimeStateWithRecipientSession
      },
    }))

    const { createTeamSendMessageTool } = await import("./messaging")
    type LiveDeliveryClient = Parameters<typeof createTeamSendMessageTool>[1]
    const client = {
      session: {
        promptAsync: async () => {
          throw new Error("promptAsync should not run when the recipient session is missing")
        },
      },
    } satisfies LiveDeliveryClient
    const tool = createTeamSendMessageTool(config, client)

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
