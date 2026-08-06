import { existsSync } from "node:fs"
import { utimes } from "node:fs/promises"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { reserveMessageForDelivery, sendMessage } from "@oh-my-opencode/team-core/team-mailbox"

import { resolveTeamMemberInboxDir, teamStorageBaseDir } from "../storage"
import { toTeamCoreConfig } from "../runtime-config"
import { buildTeamMessage } from "./message"
import { reclaimStaleTeamReservations } from "./reclaim"
import { cleanupMessagingTmp, stateDirConfig, tempProjectDir } from "./__fixtures__/messaging-fakes"
import { taskSettings } from "../__fixtures__/runtime-fakes"

const TEAM_RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const STALE_TTL_MS = 30_000

afterEach(() => {
  cleanupMessagingTmp()
})

function setup() {
  const stateDir = stateDirConfig(tempProjectDir())
  const config = toTeamCoreConfig(taskSettings(), teamStorageBaseDir(stateDir))
  return { stateDir, config }
}

function reservedPath(stateDir: ReturnType<typeof setup>["stateDir"], recipient: string, messageId: string): string {
  return join(resolveTeamMemberInboxDir(stateDir, TEAM_RUN_ID, recipient), `.delivering-${messageId}.json`)
}

async function reserveOne(
  stateDir: ReturnType<typeof setup>["stateDir"],
  config: ReturnType<typeof setup>["config"],
  recipient: string,
  options: { readonly age?: boolean } = {},
) {
  const message = buildTeamMessage({ from: "alpha", to: recipient, body: "b" })
  await sendMessage(message, TEAM_RUN_ID, config, { isLead: false, activeMembers: [recipient] })
  await reserveMessageForDelivery(TEAM_RUN_ID, recipient, message.messageId, config)
  if (options.age === true) {
    const past = new Date(Date.now() - STALE_TTL_MS * 4)
    await utimes(reservedPath(stateDir, recipient, message.messageId), past, past)
  }
  return message
}

describe("reclaimStaleTeamReservations", () => {
  test("#given a stale reservation older than the ttl #when reclaimed #then it is restored to unread", async () => {
    // given
    const { stateDir, config } = setup()
    const message = await reserveOne(stateDir, config, "beta", { age: true })
    const inboxDir = resolveTeamMemberInboxDir(stateDir, TEAM_RUN_ID, "beta")

    // when
    const reclaimed = await reclaimStaleTeamReservations(TEAM_RUN_ID, ["beta"], config, STALE_TTL_MS)

    // then
    expect(reclaimed).toEqual({ beta: [message.messageId] })
    expect(existsSync(join(inboxDir, `${message.messageId}.json`))).toBe(true)
    expect(existsSync(reservedPath(stateDir, "beta", message.messageId))).toBe(false)
  })

  test("#given a fresh reservation within the ttl #when reclaimed #then nothing is restored", async () => {
    // given
    const { stateDir, config } = setup()
    await reserveOne(stateDir, config, "beta")

    // when
    const reclaimed = await reclaimStaleTeamReservations(TEAM_RUN_ID, ["beta"], config, STALE_TTL_MS)

    // then
    expect(reclaimed).toEqual({ beta: [] })
  })

  test("#given multiple members #when reclaimed #then each member's stale reservations are reported per name", async () => {
    // given
    const { stateDir, config } = setup()
    const beta = await reserveOne(stateDir, config, "beta", { age: true })
    const gamma = await reserveOne(stateDir, config, "gamma", { age: true })

    // when
    const reclaimed = await reclaimStaleTeamReservations(TEAM_RUN_ID, ["beta", "gamma"], config, STALE_TTL_MS)

    // then
    expect(reclaimed).toEqual({ beta: [beta.messageId], gamma: [gamma.messageId] })
  })
})
