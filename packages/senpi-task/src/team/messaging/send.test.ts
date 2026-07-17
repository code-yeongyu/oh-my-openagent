import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { PersistedTaskEvent } from "../../store"
import { taskSettings } from "../__fixtures__/runtime-fakes"
import { writeMemberTaskMap } from "../member-map"
import { toTeamCoreConfig } from "../runtime-config"
import { ensureTeamRuntimeDirs, resolveTeamMemberInboxDir, resolveTeamRuntimeDirs, teamStorageBaseDir } from "../storage"
import { cleanupMessagingTmp, stateDirConfig, tempProjectDir } from "./__fixtures__/messaging-fakes"
import { sendTeamMessage } from "./send"
import type { MemberTaskMap, MessagingEngineDeps } from "./types"

const TEAM_RUN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

type AppendedEvent = {
  readonly taskId: string
  readonly event: PersistedTaskEvent
}

afterEach(() => {
  cleanupMessagingTmp()
})

async function setup(memberMap: MemberTaskMap) {
  const stateDir = stateDirConfig(tempProjectDir())
  const config = toTeamCoreConfig(taskSettings(), teamStorageBaseDir(stateDir))
  await ensureTeamRuntimeDirs(stateDir, TEAM_RUN_ID, Object.keys(memberMap))
  const runtimeDir = resolveTeamRuntimeDirs(stateDir, TEAM_RUN_ID).runtimeDir
  await writeMemberTaskMap(runtimeDir, memberMap)
  return { stateDir, config }
}

function deps(
  stateDir: ReturnType<typeof stateDirConfig>,
  config: ReturnType<typeof toTeamCoreConfig>,
  memberMap: MemberTaskMap,
  options: Pick<MessagingEngineDeps, "appendEvent" | "newMessageId"> = {},
): MessagingEngineDeps {
  return {
    teamRunId: TEAM_RUN_ID,
    stateDir,
    config,
    activeMembers: Object.keys(memberMap),
    ...options,
  }
}

function unreadPath(stateDir: ReturnType<typeof stateDirConfig>, recipient: string, messageId: string): string {
  return join(resolveTeamMemberInboxDir(stateDir, TEAM_RUN_ID, recipient), `${messageId}.json`)
}

function processedPath(stateDir: ReturnType<typeof stateDirConfig>, recipient: string, messageId: string): string {
  return join(resolveTeamMemberInboxDir(stateDir, TEAM_RUN_ID, recipient), "processed", `${messageId}.json`)
}

function unreadFiles(stateDir: ReturnType<typeof stateDirConfig>, recipient: string): string[] {
  return readdirSync(resolveTeamMemberInboxDir(stateDir, TEAM_RUN_ID, recipient))
    .filter((name) => name.endsWith(".json") && !name.startsWith("."))
}

describe("sendTeamMessage pull-only delivery", () => {
  test("#given a member recipient w2send #when a member sends #then one unread file is written and the send returns enqueued", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a", beta: "st_b" }
    const { stateDir, config } = await setup(map)
    const messageId = "11111111-1111-4111-8111-111111111111"

    // when
    const result = await sendTeamMessage(
      { from: "alpha", to: "beta", body: "ping" },
      deps(stateDir, config, map, { newMessageId: () => messageId }),
    )

    // then
    expect(result).toEqual({ kind: "to_members", messageId, recipients: ["beta"] })
    expect(unreadFiles(stateDir, "beta")).toEqual([`${messageId}.json`])
    expect(existsSync(processedPath(stateDir, "beta", messageId))).toBe(false)
  })

  test("#given the lead sentinel w2send #when a member sends #then the lead inbox receives an unread file", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a" }
    const { stateDir, config } = await setup(map)
    const messageId = "22222222-2222-4222-8222-222222222222"

    // when
    const result = await sendTeamMessage(
      { from: "alpha", to: "lead", body: "need a call" },
      deps(stateDir, config, map, { newMessageId: () => messageId }),
    )

    // then
    expect(result).toEqual({ kind: "to_lead", messageId })
    expect(unreadFiles(stateDir, "lead")).toEqual([`${messageId}.json`])
    expect(existsSync(processedPath(stateDir, "lead", messageId))).toBe(false)
  })

  test("#given three active members w2send #when the lead broadcasts #then every recipient inbox stays unread", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a", beta: "st_b", gamma: "st_g" }
    const { stateDir, config } = await setup(map)
    const messageId = "33333333-3333-4333-8333-333333333333"
    const appended: AppendedEvent[] = []

    // when
    const result = await sendTeamMessage(
      { from: "lead", to: "*", body: "all-hands" },
      deps(stateDir, config, map, {
        newMessageId: () => messageId,
        appendEvent: (taskId, event) => appended.push({ taskId, event }),
      }),
    )

    // then
    expect(result).toEqual({ kind: "to_members", messageId, recipients: ["alpha", "beta", "gamma"] })
    for (const member of ["alpha", "beta", "gamma"]) {
      expect(existsSync(unreadPath(stateDir, member, messageId))).toBe(true)
      expect(existsSync(processedPath(stateDir, member, messageId))).toBe(false)
    }
    expect(appended.map(({ taskId }) => taskId)).toEqual(["st_a", "st_b", "st_g"])
  })

  test("#given a member task mapping w2send #when the member sends #then team_message_sent is anchored to the sender record", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a", beta: "st_b" }
    const { stateDir, config } = await setup(map)
    const messageId = "44444444-4444-4444-8444-444444444444"
    const appended: AppendedEvent[] = []

    // when
    await sendTeamMessage(
      { from: "alpha", to: "beta", body: "status" },
      deps(stateDir, config, map, {
        newMessageId: () => messageId,
        appendEvent: (taskId, event) => appended.push({ taskId, event }),
      }),
    )

    // then
    expect(appended).toEqual([
      {
        taskId: "st_a",
        event: {
          type: "team_message_sent",
          payload: { message_id: messageId, from: "alpha", to: "beta", kind: "message" },
        },
      },
    ])
  })

  test("#given no appendEvent dependency w2send #when the lead sends #then enqueue still succeeds", async () => {
    // given
    const map: MemberTaskMap = { beta: "st_b" }
    const { stateDir, config } = await setup(map)
    const messageId = "55555555-5555-4555-8555-555555555555"

    // when
    const result = await sendTeamMessage(
      { from: "lead", to: "beta", body: "continue" },
      deps(stateDir, config, map, { newMessageId: () => messageId }),
    )

    // then
    expect(result).toEqual({ kind: "to_members", messageId, recipients: ["beta"] })
  })

  test("#given a full recipient inbox w2send #when a member sends #then RecipientBackpressureError still surfaces", async () => {
    // given
    const map: MemberTaskMap = { alpha: "st_a", beta: "st_b" }
    const { stateDir, config } = await setup(map)
    const constrained = { ...config, recipient_unread_max_bytes: 1 }

    // when
    const attempt = sendTeamMessage(
      { from: "alpha", to: "beta", body: "x" },
      deps(stateDir, constrained, map, { newMessageId: () => "66666666-6666-4666-8666-666666666666" }),
    )

    // then
    expect(attempt).rejects.toMatchObject({ name: "RecipientBackpressureError" })
  })
})
