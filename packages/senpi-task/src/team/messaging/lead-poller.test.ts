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
import { createLeadDeliveryJournal, type LeadDeliveryJournal } from "./delivery-journal"
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

function poller(harness: Harness, extras: { journal?: LeadDeliveryJournal; remove?: (key: string) => boolean } = {}): LeadPoller {
  return createLeadPoller({
    teamRunId: TEAM_RUN_ID,
    config: harness.config,
    coordinator: {
      enqueue: (injection) => harness.injections.push(injection),
      ...(extras.remove !== undefined ? { remove: extras.remove } : {}),
    },
    waitRegistry: harness.registry,
    ...(extras.journal !== undefined ? { deliveryJournal: extras.journal } : {}),
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

  test("#given an unread message with no registered wait w2lead #when polled #then the delivery is recorded in the journal", async () => {
    // given
    const harness = createHarness()
    const value = message("88888888-8888-4888-8888-888888888888")
    await seed(harness, value)
    const journal = createLeadDeliveryJournal()

    // when
    await poller(harness, { journal }).pollOnce()

    // then
    expect(harness.injections).toHaveLength(1)
    expect(journal.takeOldestUnreported(TEAM_RUN_ID, {})?.messageId).toBe(value.messageId)
  })

  test("#given a matching registered wait w2lead #when the poller claims #then the journal entry is marked reported", async () => {
    // given
    const harness = createHarness()
    const value = message("99999999-9999-4999-8999-999999999999")
    await seed(harness, value)
    const journal = createLeadDeliveryJournal()
    harness.registry.register(TEAM_RUN_ID, {})

    // when
    await poller(harness, { journal }).pollOnce()

    // then
    expect(journal.takeOldestUnreported(TEAM_RUN_ID, {})).toBeUndefined()
  })

  test("#given a pending unflushed delivery w2lead #when suppressDelivered runs #then the injection is removed and the reservation commits", async () => {
    // given
    const harness = createHarness()
    const value = message("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    await seed(harness, value)
    const journal = createLeadDeliveryJournal()
    const removed: string[] = []
    const leadPoller = poller(harness, {
      journal,
      remove: (key) => {
        const index = harness.injections.findIndex((injection) => injection.key === key)
        if (index < 0) return false
        harness.injections.splice(index, 1)
        removed.push(key)
        return true
      },
    })
    await leadPoller.pollOnce()
    expect(harness.injections).toHaveLength(1)

    // when
    const suppressed = await leadPoller.suppressDelivered(value.messageId)

    // then
    expect(suppressed).toBe(true)
    expect(removed).toEqual([`team-message:${value.messageId}`])
    expect(harness.injections).toHaveLength(0)
    expect(existsSync(processedPath(harness, value))).toBe(true)
    expect(journal.takeOldestUnreported(TEAM_RUN_ID, {})).toBeUndefined()
    expect(harness.events.map((entry) => entry.event.type)).toEqual(["team_message_delivered", "team_message_waited"])
  })

  test("#given an already-flushed delivery w2lead #when suppressDelivered runs #then it refuses and the persistence path still completes", async () => {
    // given
    const harness = createHarness()
    const value = message("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
    await seed(harness, value)
    const leadPoller = poller(harness, { remove: () => true })
    await leadPoller.pollOnce()
    flushLatest(harness)

    // when
    const suppressed = await leadPoller.suppressDelivered(value.messageId)

    // then
    expect(suppressed).toBe(false)
    expect(existsSync(processedPath(harness, value))).toBe(false)
    persistEnvelope(harness, value)
    await leadPoller.pollOnce()
    expect(existsSync(processedPath(harness, value))).toBe(true)
  })

  test("#given a sink without removal support w2lead #when suppressDelivered runs #then it refuses and keeps the injection", async () => {
    // given
    const harness = createHarness()
    const value = message("cccccccc-cccc-4ccc-8ccc-cccccccccccc")
    await seed(harness, value)
    const leadPoller = poller(harness)
    await leadPoller.pollOnce()

    // when / then
    expect(await leadPoller.suppressDelivered(value.messageId)).toBe(false)
    expect(harness.injections).toHaveLength(1)
  })

  test("#given a message delivered while no wait was registered w2lead #when a later team_wait starts #then it drains the delivery and suppresses the pending injection", async () => {
    // given the audit-session race: the message was processed in the no-claim window
    const harness = createHarness()
    const value = message("dddddddd-dddd-4ddd-8ddd-dddddddddddd")
    await seed(harness, value)
    const journal = createLeadDeliveryJournal()
    const removed: string[] = []
    const leadPoller = poller(harness, {
      journal,
      remove: (key) => {
        const index = harness.injections.findIndex((injection) => injection.key === key)
        if (index < 0) return false
        harness.injections.splice(index, 1)
        removed.push(key)
        return true
      },
    })
    await leadPoller.pollOnce()
    expect(harness.injections).toHaveLength(1)

    // when the lead calls team_wait right after
    const result = await runTeamWait({
      service: createFakeTeamService(),
      waitBounds: { min_ms: 1, default_ms: 5, max_ms: 10 },
      registry: harness.registry,
      deliveryJournal: journal,
      resolveLeadPoller: () => leadPoller,
      resolveTeamRunId: async () => ({ ok: true, teamRunId: TEAM_RUN_ID } as const),
    }, { timeout_ms: 5 }, undefined)

    // then the wait reports the message instead of starving, and the pending injection is dropped
    expect(result.details).toMatchObject({ kind: "message", message_id: value.messageId })
    expect(removed).toEqual([`team-message:${value.messageId}`])
    expect(harness.injections).toHaveLength(0)
    expect(existsSync(processedPath(harness, value))).toBe(true)
    expect(harness.registry.size).toBe(0)
  })

  test("#given a delivery committed via the steer-and-persist path w2lead #when the journal is drained #then the steered message is not re-reported", async () => {
    // given
    const harness = createHarness()
    const value = message("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    await seed(harness, value)
    const journal = createLeadDeliveryJournal()
    const leadPoller = poller(harness, { journal })
    await leadPoller.pollOnce()
    expect(harness.injections).toHaveLength(1)

    // when the injection flushes and the envelope persists, and the poller settles the commit
    flushLatest(harness)
    persistEnvelope(harness, value)
    await leadPoller.pollOnce()

    // then the push channel won; the journal must not re-report it to a later wait
    expect(existsSync(processedPath(harness, value))).toBe(true)
    expect(journal.takeOldestUnreported(TEAM_RUN_ID, {})).toBeUndefined()
  })

  test("#given a suppressed delivery w2lead #when suppressDelivered succeeds #then a waited recovery event is appended", async () => {
    // given
    const harness = createHarness()
    const value = message("ffffffff-ffff-4fff-8fff-ffffffffffff")
    await seed(harness, value)
    const leadPoller = poller(harness, {
      remove: (key) => {
        if (!key.startsWith("team-message:")) return false
        harness.injections.splice(0)
        return true
      },
    })
    await leadPoller.pollOnce()

    // when
    const suppressed = await leadPoller.suppressDelivered(value.messageId)

    // then
    expect(suppressed).toBe(true)
    expect(harness.events.at(-1)).toMatchObject({
      event: { type: "team_message_waited", payload: { message_id: value.messageId, from: "alpha", body: "ready" } },
    })
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
