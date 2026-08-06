import { existsSync } from "node:fs"
import { utimes } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { reserveMessageForDelivery, sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { normalizeSenpiTeamSpec, TEAM_LEAD_SENTINEL } from "../normalize"
import { createTeam } from "../runtime"
import { toTeamCoreConfig } from "../runtime-config"
import { resolveTeamMemberInboxDir, teamStorageBaseDir } from "../storage"
import { buildTeamMessage } from "./message"
import { reconcileTeamMailboxOnSessionStart } from "./session-start-reconcile"
import { FakeTeamManager, cleanupTeamRuntimeTmp, stateDirConfig, taskSettings, tempProjectDir } from "../__fixtures__/runtime-fakes"

const STALE_TTL_MS = 30_000

afterEach(() => {
  cleanupTeamRuntimeTmp()
})

async function activeTeamWithMember(member = "beta") {
  const stateDir = stateDirConfig(tempProjectDir())
  const settings = taskSettings()
  const config = toTeamCoreConfig(settings, teamStorageBaseDir(stateDir))
  const spec = normalizeSenpiTeamSpec(
    { members: [{ name: member, kind: "category", category: "quick", prompt: "p" }] },
    "squad",
  )
  const created = await createTeam(spec, "project", {
    manager: new FakeTeamManager(),
    stateDir,
    taskSettings: settings,
    leadSessionId: "lead-session",
    spawnDepth: 1,
  })
  return { stateDir, config, teamRunId: created.runtimeState.teamRunId, member }
}

async function reserveAndAge(
  stateDir: Awaited<ReturnType<typeof activeTeamWithMember>>["stateDir"],
  config: Awaited<ReturnType<typeof activeTeamWithMember>>["config"],
  teamRunId: string,
  member: string,
  options: { readonly age?: boolean } = {},
) {
  const message = buildTeamMessage({ from: "alpha", to: member, body: "b" })
  await sendMessage(message, teamRunId, config, { isLead: false, activeMembers: [member] })
  await reserveMessageForDelivery(teamRunId, member, message.messageId, config)
  const reserved = join(resolveTeamMemberInboxDir(stateDir, teamRunId, member), `.delivering-${message.messageId}.json`)
  if (options.age === true) {
    const past = new Date(Date.now() - STALE_TTL_MS * 4)
    await utimes(reserved, past, past)
  }
  return { message, reserved }
}

async function reserveLeadAndAge(
  stateDir: Awaited<ReturnType<typeof activeTeamWithMember>>["stateDir"],
  config: Awaited<ReturnType<typeof activeTeamWithMember>>["config"],
  teamRunId: string,
  member: string,
) {
  const message = buildTeamMessage({ from: member, to: TEAM_LEAD_SENTINEL, body: "lead note" })
  await sendMessage(message, teamRunId, config, {
    isLead: false,
    activeMembers: [member],
    leadRecipient: TEAM_LEAD_SENTINEL,
  })
  await reserveMessageForDelivery(teamRunId, TEAM_LEAD_SENTINEL, message.messageId, config)
  const inboxDir = resolveTeamMemberInboxDir(stateDir, teamRunId, TEAM_LEAD_SENTINEL)
  const reserved = join(inboxDir, `.delivering-${message.messageId}.json`)
  const past = new Date(Date.now() - STALE_TTL_MS * 4)
  await utimes(reserved, past, past)
  return { message, inboxDir, reserved }
}

describe("reconcileTeamMailboxOnSessionStart", () => {
  test("#given an active team with a stale reservation #when reconciled #then the reservation is restored to unread", async () => {
    // given
    const { stateDir, config, teamRunId, member } = await activeTeamWithMember()
    const inboxDir = resolveTeamMemberInboxDir(stateDir, teamRunId, member)
    const { message, reserved } = await reserveAndAge(stateDir, config, teamRunId, member, { age: true })

    // when
    await reconcileTeamMailboxOnSessionStart({ stateDir, config, staleTtlMs: STALE_TTL_MS })

    // then
    expect(existsSync(join(inboxDir, `${message.messageId}.json`))).toBe(true)
    expect(existsSync(reserved)).toBe(false)
  })

  test("#given a fresh reservation within the ttl #when reconciled #then it is left reserved", async () => {
    // given
    const { stateDir, config, teamRunId, member } = await activeTeamWithMember()
    const { reserved } = await reserveAndAge(stateDir, config, teamRunId, member)

    // when
    await reconcileTeamMailboxOnSessionStart({ stateDir, config, staleTtlMs: STALE_TTL_MS })

    // then
    expect(existsSync(reserved)).toBe(true)
  })

  test("#given an owned team with a stale lead reservation #when reconciled #then the lead inbox is restored", async () => {
    // given
    const { stateDir, config, teamRunId, member } = await activeTeamWithMember()
    const { message, inboxDir, reserved } = await reserveLeadAndAge(stateDir, config, teamRunId, member)

    // when
    await reconcileTeamMailboxOnSessionStart({
      stateDir,
      config,
      staleTtlMs: STALE_TTL_MS,
      currentLeadSessionId: "lead-session",
    })

    // then
    expect(existsSync(join(inboxDir, `${message.messageId}.json`))).toBe(true)
    expect(existsSync(reserved)).toBe(false)
  })

  test("#given a foreign team with a stale lead reservation #when reconciled #then its lead inbox is untouched", async () => {
    // given
    const { stateDir, config, teamRunId, member } = await activeTeamWithMember()
    const { reserved } = await reserveLeadAndAge(stateDir, config, teamRunId, member)

    // when
    await reconcileTeamMailboxOnSessionStart({
      stateDir,
      config,
      staleTtlMs: STALE_TTL_MS,
      currentLeadSessionId: "another-session",
    })

    // then
    expect(existsSync(reserved)).toBe(true)
  })

  test("#given no active teams #when reconciled #then it is a no-op that does not throw", async () => {
    // given
    const stateDir = stateDirConfig(tempProjectDir())
    const config = toTeamCoreConfig(taskSettings(), teamStorageBaseDir(stateDir))

    // when / then
    await reconcileTeamMailboxOnSessionStart({ stateDir, config, staleTtlMs: STALE_TTL_MS })
  })
})
