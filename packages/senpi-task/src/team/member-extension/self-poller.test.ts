import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import {
  commitDeliveryReservation,
  reserveMessageForDelivery,
  sendMessage,
} from "@oh-my-opencode/team-core/team-mailbox"
import type { Message } from "@oh-my-opencode/team-core/types"

import type { PersistedTaskEvent } from "../../store"
import { buildPeerMessageEnvelope } from "../messaging/message"
import { WaitRegistry } from "../messaging/wait-registry"
import { createMemberSelfPoller } from "./self-poller"

const TEAM_RUN_ID = "11111111-1111-4111-8111-111111111111"
const roots: string[] = []

type Harness = {
  readonly config: TeamModeConfig
  readonly inboxDir: string
  readonly sessionDir: string
  readonly injected: string[]
  readonly events: PersistedTaskEvent[]
  readonly registry: WaitRegistry<Message>
}

function createHarness(): Harness {
  const root = mkdtempSync(join(tmpdir(), "senpi-member-poller-"))
  roots.push(root)
  const baseDir = join(root, "teams")
  const sessionDir = join(root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  return {
    config: TeamModeConfigSchema.parse({ base_dir: baseDir }),
    inboxDir: join(baseDir, "runtime", TEAM_RUN_ID, "inboxes", "alice"),
    sessionDir,
    injected: [],
    events: [],
    registry: new WaitRegistry<Message>(),
  }
}

function message(messageId: string, body = "hello"): Message {
  return {
    version: 1,
    messageId,
    from: "lead",
    to: "alice",
    kind: "message",
    body,
    timestamp: 1,
  }
}

async function seed(harness: Harness, value: Message): Promise<void> {
  await sendMessage(value, TEAM_RUN_ID, harness.config, { isLead: true, activeMembers: ["alice"] })
}

function poller(harness: Harness) {
  return createMemberSelfPoller({
    teamRunId: TEAM_RUN_ID,
    memberName: "alice",
    config: harness.config,
    sessionDir: harness.sessionDir,
    waitRegistry: harness.registry,
    sendUserMessage: (content) => harness.injected.push(content),
    appendEvent: (event) => harness.events.push(event),
  })
}

function persistEnvelope(harness: Harness, value: Message): void {
  const entry = {
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text: buildPeerMessageEnvelope(value) }],
    },
  }
  writeFileSync(join(harness.sessionDir, "20260712_session.jsonl"), `${JSON.stringify(entry)}\n`, "utf8")
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("member self-poller", () => {
  test("#given an after-inject hold w2mem #when delivery reaches the crash window #then reservation stays uncommitted until released", async () => {
    // given
    const harness = createHarness()
    const value = message("11111111-1111-4111-8111-111111111111")
    await seed(harness, value)
    let releaseHold = (): void => undefined
    const hold = new Promise<void>((resolve) => { releaseHold = resolve })
    let reportEntered = (): void => undefined
    const entered = new Promise<void>((resolve) => { reportEntered = resolve })
    const selfPoller = createMemberSelfPoller({
      teamRunId: TEAM_RUN_ID,
      memberName: "alice",
      config: harness.config,
      sessionDir: harness.sessionDir,
      waitRegistry: harness.registry,
      sendUserMessage: (content) => harness.injected.push(content),
      appendEvent: (event) => harness.events.push(event),
      afterInject: async () => {
        reportEntered()
        await hold
      },
    })

    // when
    const polling = selfPoller.pollOnce()
    await entered

    // then
    expect(harness.injected).toEqual([buildPeerMessageEnvelope(value)])
    expect(existsSync(join(harness.inboxDir, `.delivering-${value.messageId}.json`))).toBe(true)
    expect(existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`))).toBe(false)

    releaseHold()
    await polling
  })

  test("#given an unread message w2mem #when its envelope reaches the session JSONL #then commit happens only after persistence", async () => {
    // given
    const harness = createHarness()
    const value = message("22222222-2222-4222-8222-222222222222")
    await seed(harness, value)
    const selfPoller = poller(harness)

    // when
    await selfPoller.pollOnce()

    // then
    expect(harness.injected).toEqual([buildPeerMessageEnvelope(value)])
    expect(existsSync(join(harness.inboxDir, `.delivering-${value.messageId}.json`))).toBe(true)
    expect(existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`))).toBe(false)

    // when durable acknowledgement appears
    persistEnvelope(harness, value)
    await selfPoller.checkPendingAcks()

    // then
    expect(existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`))).toBe(true)
    expect(harness.events.at(-1)).toEqual({
      type: "team_message_delivered",
      payload: { message_id: value.messageId, from: "lead", to: "alice", kind: "message" },
    })
  })

  test("#given an inject with no acknowledgement yet w2mem #when ack checks repeat #then the reservation is held and never double-injected", async () => {
    // given
    const harness = createHarness()
    const value = message("33333333-3333-4333-8333-333333333333")
    await seed(harness, value)
    const selfPoller = poller(harness)

    // when
    await selfPoller.pollOnce()
    await selfPoller.checkPendingAcks()
    await selfPoller.pollOnce()

    // then
    expect(harness.injected).toHaveLength(1)
    expect(existsSync(join(harness.inboxDir, `.delivering-${value.messageId}.json`))).toBe(true)
    expect(existsSync(join(harness.inboxDir, `${value.messageId}.json`))).toBe(false)

    // when
    persistEnvelope(harness, value)
    await selfPoller.checkPendingAcks()

    // then
    expect(harness.injected).toHaveLength(1)
    expect(existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`))).toBe(true)
  })

  test("#given a crash after envelope persistence w2mem #when a new poller recovers #then it commits without reinjecting", async () => {
    // given
    const harness = createHarness()
    const value = message("44444444-4444-4444-8444-444444444444")
    await seed(harness, value)
    await poller(harness).pollOnce()
    persistEnvelope(harness, value)

    // when
    await poller(harness).recoverReservations()

    // then
    expect(harness.injected).toHaveLength(1)
    expect(existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`))).toBe(true)
    expect(existsSync(join(harness.inboxDir, `.delivering-${value.messageId}.json`))).toBe(false)
  })

  test("#given a consumed-ledger stray w2mem #when the poller sees the duplicate unread file #then it acks without injecting", async () => {
    // given
    const harness = createHarness()
    const value = message("55555555-5555-4555-8555-555555555555")
    await seed(harness, value)
    const reservation = await reserveMessageForDelivery(TEAM_RUN_ID, "alice", value.messageId, harness.config)
    expect(reservation).not.toBeNull()
    if (reservation === null) return
    await commitDeliveryReservation(reservation)
    await seed(harness, value)

    // when
    await poller(harness).pollOnce()

    // then
    expect(harness.injected).toEqual([])
    expect(existsSync(join(harness.inboxDir, `${value.messageId}.json`))).toBe(false)
    expect(existsSync(join(harness.inboxDir, "processed", `${value.messageId}.json`))).toBe(true)
  })
})
