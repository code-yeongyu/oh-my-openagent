import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"
import type { Message } from "@oh-my-opencode/team-core/types"

import { createLeadDeliveryJournal } from "./delivery-journal"
import { createLeadPoller, type LeadInjection, type LeadPoller } from "./lead-poller"
import { buildPeerMessageEnvelope } from "./message"

const TEAM_RUN_ID = "11111111-1111-4111-8111-111111111111"
const roots: string[] = []

type Harness = {
  readonly config: TeamModeConfig
  readonly inboxDir: string
  readonly sessionFile: string
  sessionFilePath: string | undefined
  readonly injections: LeadInjection[]
}

function createHarness(sessionAvailable = true): Harness {
  const root = mkdtempSync(join(tmpdir(), "senpi-lead-poller-"))
  roots.push(root)
  const baseDir = join(root, "teams")
  const sessionDir = join(root, "sessions")
  const sessionFile = join(sessionDir, "20260712_lead.jsonl")
  mkdirSync(sessionDir, { recursive: true })
  return {
    config: TeamModeConfigSchema.parse({ base_dir: baseDir }),
    inboxDir: join(baseDir, "runtime", TEAM_RUN_ID, "inboxes", "lead"),
    sessionFile,
    sessionFilePath: sessionAvailable ? sessionFile : undefined,
    injections: [],
  }
}

function message(messageId: string, body = "ready"): Message {
  return { version: 1, messageId, from: "alpha", to: "lead", kind: "message", body, timestamp: 1 }
}

async function seed(harness: Harness, value: Message): Promise<void> {
  await sendMessage(value, TEAM_RUN_ID, harness.config, {
    isLead: false,
    activeMembers: ["alpha"],
    leadRecipient: "lead",
  })
}

function poller(harness: Harness): LeadPoller {
  return createLeadPoller({
    teamRunId: TEAM_RUN_ID,
    config: harness.config,
    coordinator: { enqueue: (injection) => harness.injections.push(injection) },
    deliveryJournal: createLeadDeliveryJournal(),
    appendEvent: () => undefined,
    eventTaskId: (value) => value.from === "alpha" ? "st_00000001" : undefined,
    leadSessionFile: () => harness.sessionFilePath,
  })
}

function persistEnvelope(harness: Harness, value: Message): void {
  const entry = { type: "message", message: { role: "user", content: buildPeerMessageEnvelope(value) } }
  writeFileSync(harness.sessionFile, `${JSON.stringify(entry)}\n`, "utf8")
}

function flushLatest(harness: Harness): void {
  const injection = harness.injections.at(-1)
  if (injection === undefined) throw new TypeError("expected a pending lead injection")
  injection.onFlushed?.()
}

function processedPath(harness: Harness, value: Message): string {
  return join(harness.inboxDir, "processed", `${value.messageId}.json`)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("lead poller injection delivery", () => {
  test("#given member mail #when the lead polls #then it injects the peer envelope without a blocking tool", async () => {
    // given
    const harness = createHarness()
    const value = message("22222222-2222-4222-8222-222222222222", "member report")
    await seed(harness, value)
    const leadPoller = poller(harness)

    // when
    await leadPoller.pollOnce()

    // then
    expect(harness.injections.map((entry) => entry.content)).toEqual([buildPeerMessageEnvelope(value)])
    expect(existsSync(processedPath(harness, value))).toBe(false)

    // when the injection reaches the durable lead transcript
    persistEnvelope(harness, value)
    flushLatest(harness)
    await leadPoller.pollOnce()

    // then mailbox commit follows durable delivery
    expect(existsSync(processedPath(harness, value))).toBe(true)
  })

  test("#given a crash before the lead injection flushes #when a fresh poller resumes #then the durable mailbox redelivers", async () => {
    // given
    const harness = createHarness()
    const value = message("33333333-3333-4333-8333-333333333333")
    await seed(harness, value)
    await poller(harness).pollOnce()

    // when
    await poller(harness).pollOnce()

    // then
    expect(harness.injections).toHaveLength(2)
    expect(existsSync(join(harness.inboxDir, `.delivering-${value.messageId}.json`))).toBe(true)
    expect(existsSync(processedPath(harness, value))).toBe(false)
  })

  test("#given a crash after lead transcript persistence #when a fresh poller resumes #then it commits without reinjecting", async () => {
    // given
    const harness = createHarness()
    const value = message("44444444-4444-4444-8444-444444444444")
    await seed(harness, value)
    await poller(harness).pollOnce()
    persistEnvelope(harness, value)

    // when
    await poller(harness).pollOnce()

    // then
    expect(harness.injections).toHaveLength(1)
    expect(existsSync(processedPath(harness, value))).toBe(true)
  })

  test("#given no captured lead transcript #when mail flushes #then the reservation holds until persistence becomes observable", async () => {
    // given
    const harness = createHarness(false)
    const value = message("55555555-5555-4555-8555-555555555555")
    await seed(harness, value)
    const leadPoller = poller(harness)
    await leadPoller.pollOnce()
    flushLatest(harness)

    // when
    await leadPoller.pollOnce()

    // then
    expect(existsSync(processedPath(harness, value))).toBe(false)

    // when a transcript is captured and records the injected envelope
    harness.sessionFilePath = harness.sessionFile
    persistEnvelope(harness, value)
    await leadPoller.pollOnce()

    // then
    expect(existsSync(processedPath(harness, value))).toBe(true)
  })
})
