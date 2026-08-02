/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { randomUUID } from "node:crypto"
import { access, mkdir, mkdtemp, readdir, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { TeamModeConfigSchema } from "../config"
import { getInboxDir, resolveBaseDir } from "../team-registry/paths"
import { createRuntimeState, loadRuntimeState } from "../team-state-store/store"
import type { TeamSpec } from "../types"
import { ackMessages } from "./ack"
import { withInboxConsumerLease } from "./consumer-lease"
import { pollAndBuildInjection } from "./poll"
import {
  commitDeliveryReservation,
  reclaimStaleReservations,
  releaseDeliveryReservation,
  reserveMessageForDelivery,
} from "./reservation"
import { sendMessage } from "./send"

async function createFixture(): Promise<{
  readonly teamRunId: string
  readonly config: ReturnType<typeof TeamModeConfigSchema.parse>
}> {
  const baseDir = await mkdtemp(path.join(tmpdir(), "team-mailbox-consumer-atomicity-"))
  const config = TeamModeConfigSchema.parse({ base_dir: baseDir })
  const spec = {
    version: 1,
    name: "team-a",
    createdAt: Date.now(),
    leadAgentId: "m1",
    members: [{
      kind: "subagent_type" as const,
      name: "m1",
      backendType: "in-process" as const,
      subagent_type: "general-purpose",
      isActive: true,
    }],
  } satisfies TeamSpec
  const runtimeState = await createRuntimeState(spec, "lead-session", "project", config)
  return { teamRunId: runtimeState.teamRunId, config }
}

async function enqueueMessage(
  teamRunId: string,
  config: ReturnType<typeof TeamModeConfigSchema.parse>,
): Promise<string> {
  const messageId = randomUUID()
  await sendMessage({
    version: 1,
    messageId,
    from: "lead",
    to: "m1",
    kind: "message",
    body: "atomic mailbox delivery",
    timestamp: Date.now(),
  }, teamRunId, config, { isLead: true, activeMembers: ["m1"] })
  return messageId
}

async function writeDeadConsumerLease(
  teamRunId: string,
  config: ReturnType<typeof TeamModeConfigSchema.parse>,
): Promise<string> {
  const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
  const leasePath = path.join(inboxDir, ".consumer.lock")
  await mkdir(inboxDir, { recursive: true })
  await writeFile(leasePath, `dead-consumer\n999999999\n${Date.now() - 1}\n`)
  return leasePath
}

describe("mailbox consumer atomicity", () => {
  test("#given a dead consumer lease w2tc #when poll claims unread messages #then it recovers the lease and records the delivery", async () => {
    // given
    const { teamRunId, config } = await createFixture()
    const messageId = await enqueueMessage(teamRunId, config)
    const leasePath = await writeDeadConsumerLease(teamRunId, config)

    // when
    const result = await pollAndBuildInjection("session-1", "m1", teamRunId, config, "turn-race")

    // then
    expect(result).toMatchObject({ injected: true, messageIds: [messageId] })
    await expect(access(leasePath)).rejects.toThrow()
    const runtimeState = await loadRuntimeState(teamRunId, config)
    const pendingIds = runtimeState.members.find((member) => member.name === "m1")?.pendingInjectedMessageIds ?? []
    expect(pendingIds).toEqual([messageId])
  })

  test("#given a dead consumer lease w2tc #when ack processes a message #then it recovers the lease and leaves no hidden inbox artifact", async () => {
    // given
    const { teamRunId, config } = await createFixture()
    const messageId = await enqueueMessage(teamRunId, config)
    const leasePath = await writeDeadConsumerLease(teamRunId, config)

    // when
    await ackMessages(teamRunId, "m1", [messageId], config)

    // then
    await expect(access(leasePath)).rejects.toThrow()
    const inboxDir = getInboxDir(resolveBaseDir(config), teamRunId, "m1")
    expect(await readdir(path.join(inboxDir, "processed"))).toContain(`${messageId}.json`)
    expect((await readdir(inboxDir)).some((entry) => entry === `${messageId}.json` || entry.startsWith(".delivering-"))).toBe(false)
  })

  test("#given reclaim wins before a delayed commit w2tc #when commit resumes #then the message has exactly one processed terminal state", async () => {
    // given
    const { teamRunId, config } = await createFixture()
    const messageId = await enqueueMessage(teamRunId, config)
    const reservation = await reserveMessageForDelivery(teamRunId, "m1", messageId, config)
    if (reservation === null) throw new Error("delivery reservation was not created")
    await utimes(reservation.reservedPath, 0, 0)
    expect(await reclaimStaleReservations(teamRunId, "m1", config, 0)).toEqual([messageId])

    // when
    await commitDeliveryReservation(reservation)

    // then
    const inboxEntries = await readdir(path.dirname(reservation.inboxPath))
    const processedEntries = await readdir(reservation.processedDir)
    expect(inboxEntries.filter((entry) => entry === `${messageId}.json` || entry === `.delivering-${messageId}.json`)).toEqual([])
    expect(processedEntries.filter((entry) => entry === `${messageId}.json`)).toEqual([`${messageId}.json`])
  })

  test("#given reclaim wins before a delayed release w2tc #when release resumes #then one unread file remains and no delivering artifact survives", async () => {
    // given
    const { teamRunId, config } = await createFixture()
    const messageId = await enqueueMessage(teamRunId, config)
    const reservation = await reserveMessageForDelivery(teamRunId, "m1", messageId, config)
    if (reservation === null) throw new Error("delivery reservation was not created")
    await utimes(reservation.reservedPath, 0, 0)
    expect(await reclaimStaleReservations(teamRunId, "m1", config, 0)).toEqual([messageId])

    // when
    await releaseDeliveryReservation(reservation)

    // then
    expect((await stat(reservation.inboxPath)).isFile()).toBe(true)
    const inboxEntries = await readdir(path.dirname(reservation.inboxPath))
    expect(inboxEntries.filter((entry) => entry === `${messageId}.json`)).toEqual([`${messageId}.json`])
    expect(inboxEntries.some((entry) => entry.startsWith(".delivering-"))).toBe(false)
  })

  test("#given ack and stale reclaim race for one reservation w2tc #when both complete #then exactly one processed file remains", async () => {
    // given
    const { teamRunId, config } = await createFixture()
    const messageId = await enqueueMessage(teamRunId, config)
    const reservation = await reserveMessageForDelivery(teamRunId, "m1", messageId, config)
    if (reservation === null) throw new Error("delivery reservation was not created")
    await utimes(reservation.reservedPath, 0, 0)
    await mkdir(reservation.processedDir, { recursive: true })

    // when
    await Promise.all([
      ackMessages(teamRunId, "m1", [messageId], config),
      reclaimStaleReservations(teamRunId, "m1", config, 0),
    ])

    // then
    const inboxEntries = await readdir(path.dirname(reservation.inboxPath))
    const processedEntries = await readdir(reservation.processedDir)
    expect(inboxEntries.filter((entry) => entry === `${messageId}.json` || entry === `.delivering-${messageId}.json`)).toEqual([])
    expect(processedEntries.filter((entry) => entry === `${messageId}.json`)).toEqual([`${messageId}.json`])
  })
})
