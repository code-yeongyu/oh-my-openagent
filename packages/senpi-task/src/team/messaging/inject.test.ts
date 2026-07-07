import { existsSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { createRuntimeState } from "@oh-my-opencode/team-core/team-state-store"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { normalizeSenpiTeamSpec } from "../normalize"
import { resolveTeamMemberInboxDir, teamStorageBaseDir } from "../storage"
import { toTeamCoreConfig } from "../runtime-config"
import { ackMemberInjection, buildMemberUnreadInjection, releaseMemberInjection } from "./inject"
import { buildPeerMessageEnvelope, buildTeamMessage } from "./message"
import { cleanupMessagingTmp, stateDirConfig, tempProjectDir } from "./__fixtures__/messaging-fakes"
import { taskSettings } from "../__fixtures__/runtime-fakes"

afterEach(() => {
  cleanupMessagingTmp()
})

async function setup() {
  const stateDir = stateDirConfig(tempProjectDir())
  const config = toTeamCoreConfig(taskSettings(), teamStorageBaseDir(stateDir))
  const spec = normalizeSenpiTeamSpec(
    { members: [{ name: "beta", kind: "category", category: "quick", prompt: "b" }] },
    "squad",
  )
  const runtimeState = await createRuntimeState(spec, "lead-session", "project", config)
  return { stateDir, config, teamRunId: runtimeState.teamRunId }
}

describe("buildMemberUnreadInjection", () => {
  test("#given an unread message #when the injection is built #then its envelope matches our own envelope (drift guard)", async () => {
    // given
    const { config, teamRunId } = await setup()
    const message = buildTeamMessage(
      { from: "alpha", to: "beta", body: "unread body" },
      { newMessageId: () => "66666666-6666-4666-8666-666666666666" },
    )
    await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["beta"] })

    // when
    const injection = await buildMemberUnreadInjection({
      sessionId: "sess-beta",
      memberName: "beta",
      teamRunId,
      config,
      turnMarker: "turn-1",
    })

    // then
    expect(injection.injected).toBe(true)
    expect(injection.messageIds).toEqual([message.messageId])
    expect(injection.content).toBe(buildPeerMessageEnvelope(message))
  })

  test("#given no unread messages #when the injection is built #then it reports nothing injected", async () => {
    // given
    const { config, teamRunId } = await setup()

    // when
    const injection = await buildMemberUnreadInjection({
      sessionId: "sess-beta",
      memberName: "beta",
      teamRunId,
      config,
      turnMarker: "turn-1",
    })

    // then
    expect(injection.injected).toBe(false)
    expect(injection.messageIds).toEqual([])
  })
})

describe("ackMemberInjection", () => {
  test("#given injected message ids #when acked #then the inbox files move to processed/", async () => {
    // given
    const { stateDir, config, teamRunId } = await setup()
    const message = buildTeamMessage(
      { from: "alpha", to: "beta", body: "b" },
      { newMessageId: () => "77777777-7777-4777-8777-777777777777" },
    )
    await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
    const injection = await buildMemberUnreadInjection({
      sessionId: "sess-beta",
      memberName: "beta",
      teamRunId,
      config,
      turnMarker: "turn-1",
    })

    // when
    await ackMemberInjection({ memberName: "beta", teamRunId, messageIds: injection.messageIds, config })

    // then
    const inboxDir = resolveTeamMemberInboxDir(stateDir, teamRunId, "beta")
    expect(existsSync(join(inboxDir, `${message.messageId}.json`))).toBe(false)
    expect(existsSync(join(inboxDir, "processed", `${message.messageId}.json`))).toBe(true)
  })
})

describe("releaseMemberInjection", () => {
  test("#given an injected-but-unacked message #when released #then the pending mark clears and a fresh injection re-includes it", async () => {
    // given
    const { config, teamRunId } = await setup()
    const message = buildTeamMessage(
      { from: "alpha", to: "beta", body: "b" },
      { newMessageId: () => "88888888-8888-4888-8888-888888888888" },
    )
    await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: ["beta"] })
    const first = await buildMemberUnreadInjection({ sessionId: "s", memberName: "beta", teamRunId, config, turnMarker: "t1" })
    expect(first.messageIds).toEqual([message.messageId])
    const blocked = await buildMemberUnreadInjection({ sessionId: "s", memberName: "beta", teamRunId, config, turnMarker: "t2" })
    expect(blocked.injected).toBe(false)

    // when
    await releaseMemberInjection({ memberName: "beta", teamRunId, messageIds: first.messageIds, config })

    // then
    const reinjected = await buildMemberUnreadInjection({ sessionId: "s", memberName: "beta", teamRunId, config, turnMarker: "t3" })
    expect(reinjected.injected).toBe(true)
    expect(reinjected.messageIds).toEqual([message.messageId])
  })

  test("#given no message ids #when released #then it is a no-op", async () => {
    // given
    const { config, teamRunId } = await setup()

    // when / then
    await releaseMemberInjection({ memberName: "beta", teamRunId, messageIds: [], config })
  })
})
