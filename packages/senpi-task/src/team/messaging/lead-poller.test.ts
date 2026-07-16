import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, describe, expect, test } from "bun:test"
import { TeamModeConfigSchema, type TeamModeConfig } from "@oh-my-opencode/team-core/config"
import { sendMessage } from "@oh-my-opencode/team-core/team-mailbox"
import type { Message } from "@oh-my-opencode/team-core/types"

import type { PersistedTaskEvent } from "../../store"
import { createFakeTeamService } from "../../tools/team/__fixtures__/team-tool-fakes"
import { runTeamWait } from "../../tools/team/wait"
import { buildPeerMessageEnvelope } from "./message"
import { WaitRegistry } from "./wait-registry"
import {
  createLeadPoller,
  type LeadInjection,
  type LeadPoller,
} from "./lead-poller"

const TEAM_RUN_ID = "11111111-1111-4111-8111-111111111111"
const roots: string[] = []

type AppendedEvent = { readonly taskId: string; readonly event: PersistedTaskEvent }

type Harness = {
  readonly config: TeamModeConfig
  readonly inboxDir: string
  readonly sessionFile: string
  sessionFilePath: string | undefined
  readonly injections: LeadInjection[]
  readonly events: AppendedEvent[]
  readonly registry: WaitRegistry<Message>
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
    events: [],
    registry: new WaitRegistry<Message>(),
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
    waitRegistry: harness.registry,
    appendEvent: (taskId, event) => harness.events.push({ taskId, event }),
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

describe("lead poller", () => {
  test("#given an unread lead message w2lead #when the coordinator flushes and the envelope persists #then commit happens strictly after flush", async () => {
    // given
    const harness = createHarness()
    const value = message("22222222-2222-4222-8222-222222222222")
    await seed(harness, value)
    const leadPoller = poller(harness)

    // when
    await leadPoller.pollOnce()

    // then
    expect(harness.injections.map((entry) => entry.content)).toEqual([buildPeerMessageEnvelope(value)])
    expect(existsSync(processedPath(harness, value))).toBe(false)

    // when the delivery returns and its durable envelope is observable
    persistEnvelope(harness, value)
    flushLatest(harness)
    expect(existsSync(processedPath(harness, value))).toBe(false)
    await leadPoller.pollOnce()

    // then
    expect(existsSync(processedPath(harness, value))).toBe(true)
  })

  test("#given a crash before coordinator flush w2lead #when a fresh poller recovers #then it redelivers exactly once", async () => {
    // given
    const harness = createHarness()
    const value = message("33333333-3333-4333-8333-333333333333")
    await seed(harness, value)
    await poller(harness).pollOnce()

    // when
    const recovered = poller(harness)
    await recovered.pollOnce()
    await recovered.pollOnce()

    // then
    expect(harness.injections).toHaveLength(2)
    expect(existsSync(join(harness.inboxDir, `.delivering-${value.messageId}.json`))).toBe(true)
    expect(existsSync(processedPath(harness, value))).toBe(false)
  })

  test("#given a crash with the peer envelope already persisted w2lead #when a fresh poller recovers #then JSONL dedup commits without reinjection", async () => {
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

  test("#given a flushed injection with no lead session file w2lead #when ticks continue #then the reservation holds until the exact JSONL appears", async () => {
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
    expect(harness.injections).toHaveLength(1)

    // when the captured session file becomes available
    harness.sessionFilePath = harness.sessionFile
    persistEnvelope(harness, value)
    await leadPoller.pollOnce()

    // then
    expect(existsSync(processedPath(harness, value))).toBe(true)
  })

  test("#given a matching registered wait w2lead #when the lead poller claims its message #then commit and recovery event precede resolution", async () => {
    // given
    const harness = createHarness()
    const value = message("66666666-6666-4666-8666-666666666666")
    await seed(harness, value)
    const registration = harness.registry.register(TEAM_RUN_ID, { from: "alpha" })
    const observed = registration.promise.then(() => existsSync(processedPath(harness, value)))

    // when
    await poller(harness).pollOnce()

    // then
    expect(await observed).toBe(true)
    expect(harness.injections).toHaveLength(0)
    expect(harness.events.at(-1)).toEqual({
      taskId: "st_00000001",
      event: {
        type: "team_message_waited",
        payload: { message_id: value.messageId, from: "alpha", body: "ready" },
      },
    })
  })

  test("#given a timed-out lead wait w2lead #when a later message arrives #then cleanup leaves it on the normal enqueue path", async () => {
    // given
    const harness = createHarness()
    const leadPoller = poller(harness)
    const deps = {
      service: createFakeTeamService(),
      waitBounds: { min_ms: 1, default_ms: 1, max_ms: 5 },
      registry: harness.registry,
      resolveLeadPoller: () => leadPoller,
      resolveTeamRunId: async () => ({ ok: true, teamRunId: TEAM_RUN_ID } as const),
    }

    // when
    const result = await runTeamWait(deps, { timeout_ms: 1 }, undefined)

    // then
    expect(result.details).toEqual({ kind: "timeout", timeout_ms: 1 })
    expect(harness.registry.size).toBe(0)

    // when a message arrives after cleanup
    const value = message("77777777-7777-4777-8777-777777777777")
    await seed(harness, value)
    await leadPoller.pollOnce()

    // then
    expect(harness.injections).toHaveLength(1)
  })

  test("#given an aborted lead wait w2lead #when cancellation wins #then no registered wait remains", async () => {
    // given
    const harness = createHarness()
    const controller = new AbortController()
    const reason = new Error("caller stopped")
    controller.abort(reason)

    // when / then
    await expect(runTeamWait({
      service: createFakeTeamService(),
      waitBounds: { min_ms: 1, default_ms: 5, max_ms: 10 },
      registry: harness.registry,
      resolveLeadPoller: () => poller(harness),
      resolveTeamRunId: async () => ({ ok: true, teamRunId: TEAM_RUN_ID } as const),
    }, {}, controller.signal)).rejects.toBe(reason)
    expect(harness.registry.size).toBe(0)
  })
})
