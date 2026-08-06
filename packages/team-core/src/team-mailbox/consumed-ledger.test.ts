/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../config"
import { MessageSchema } from "../types"
import { commitDeliveryReservation, reserveMessageForDelivery } from "./reservation"
import { sendMessage } from "./send"
import { isMessageConsumed } from "./consumed-ledger"

async function createBaseDirectory(): Promise<string> {
  return await mkdtemp(path.join(tmpdir(), "team-mailbox-consumed-ledger-"))
}

describe("isMessageConsumed", () => {
  test("#given an unread message without a committed reservation w2tc #when consumption is checked #then it is false", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const message = MessageSchema.parse({
      version: 1,
      messageId: randomUUID(),
      from: "lead",
      to: "m1",
      kind: "message",
      body: "pending",
      timestamp: Date.now(),
    })
    await sendMessage(message, teamRunId, config, { isLead: true, activeMembers: ["m1"] })

    // when
    const consumed = await isMessageConsumed(teamRunId, "m1", message.messageId, config)

    // then
    expect(consumed).toBe(false)
  })

  test("#given a committed delivery reservation w2tc #when consumption is checked #then it is true", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ base_dir: await createBaseDirectory() })
    const teamRunId = randomUUID()
    const message = MessageSchema.parse({
      version: 1,
      messageId: randomUUID(),
      from: "lead",
      to: "m1",
      kind: "message",
      body: "committed",
      timestamp: Date.now(),
    })
    await sendMessage(message, teamRunId, config, { isLead: true, activeMembers: ["m1"] })
    const reservation = await reserveMessageForDelivery(teamRunId, "m1", message.messageId, config)
    if (reservation === null) {
      throw new Error("expected delivery reservation")
    }
    await commitDeliveryReservation(reservation)

    // when
    const consumed = await isMessageConsumed(teamRunId, "m1", message.messageId, config)

    // then
    expect(consumed).toBe(true)
  })
})
