import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { buildIdentityPaths, type MemoryIdentity } from "../identity"
import { TranscriptJournal } from "../journal"
import type { ReflectionRequest } from "./machine"
import {
  REFLECTION_PARK_NON_RETRYABLE_STREAK,
  REFLECTION_PARK_PROBE_INTERVAL_MS,
  REFLECTION_PARK_RETRYABLE_STREAK,
  type ReflectionFailureSignal,
} from "./park"
import { ReflectionReservationStore } from "./reservation"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }))))

const T0 = Date.parse("2026-09-15T06:00:00.000Z")
const deterministic: ReflectionFailureSignal = { fingerprint: "spawn_failed:Model not found", retryable: false, reason: "spawn_failed", detail: "Model not found" }
const transient: ReflectionFailureSignal = { fingerprint: "child_exit:OpenAI API error (429)", retryable: true, reason: "child_exit", detail: "OpenAI API error (429)" }

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "reflection-park-")))
  roots.push(root)
  const identity: MemoryIdentity = { id: "agent-test", safeSlug: "agent-test", paths: buildIdentityPaths(root, "agent-test") }
  let nowMs = T0
  const now = () => new Date(nowMs)
  const journal = new TranscriptJournal({ journalDir: join(identity.paths.transcripts, "conversation-a"), now })
  await journal.reconcile([
    { kind: "user", messageId: "user-1", text: "remember" },
    { kind: "assistant", messageId: "assistant-1", textBlocks: ["one"] },
  ])
  let nextId = 0
  const store = new ReflectionReservationStore({
    identity,
    config: { stepCount: 1, onCompaction: true },
    now,
    launcherIdentity: async () => ({ pid: 4242, hostname: "fixture-host", processStart: "fixture-start" }),
    getJournal: async () => journal,
    createRunId: () => `run-${++nextId}`,
  })
  const advance = (ms: number) => { nowMs += ms }
  const parkPath = join(identity.paths.reflection, "park.json")
  return { identity, journal, store, advance, parkPath }
}

async function automaticRequest(journal: TranscriptJournal, trigger: "step-count" | "compaction" = "step-count"): Promise<ReflectionRequest> {
  const snapshot = await journal.captureReflectionSnapshot()
  return { trigger, conversationIds: ["conversation-a"], snapshots: snapshot === null ? [] : [{ conversationId: "conversation-a", snapshot }] }
}

async function failAutomaticRuns(item: Awaited<ReturnType<typeof fixture>>, count: number, failure: ReflectionFailureSignal) {
  for (let index = 0; index < count; index += 1) {
    const reserved = await item.store.tryReserve(await automaticRequest(item.journal))
    if (reserved.status !== "active") throw new Error(`expected an active reservation, got ${reserved.status}`)
    await item.store.complete(reserved.run.runId, "failed", { failure })
    item.advance(60_000)
  }
}

describe("reflection reservation park", () => {
  it("#given automatic runs failing deterministically #when the streak reaches the threshold #then the identity parks and automatic evaluation is refused", async () => {
    // given
    const item = await fixture()

    // when
    await failAutomaticRuns(item, REFLECTION_PARK_NON_RETRYABLE_STREAK, deterministic)

    // then
    const park = await item.store.readPark()
    expect(park.parkedAt).toBeDefined()
    expect(park.streak).toBe(REFLECTION_PARK_NON_RETRYABLE_STREAK)
    expect(park.lastFailure?.fingerprint).toBe(deterministic.fingerprint)
    expect(existsSync(item.parkPath)).toBe(true)
    item.advance(10 * 60_000)
    const evaluated = await item.store.evaluate("conversation-a", { kind: "settled", success: true })
    expect(evaluated?.status).toBe("parked")
    expect((await item.store.readState()).active).toBeUndefined()
  })

  it("#given a parked identity #when a manual reflection is requested #then it is reserved and its success clears the park", async () => {
    // given
    const item = await fixture()
    await failAutomaticRuns(item, REFLECTION_PARK_NON_RETRYABLE_STREAK, deterministic)

    // when
    const manual = await item.store.tryReserve({ trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] })
    expect(manual.status).toBe("active")
    if (manual.status !== "active") throw new Error("unreachable")
    const completion = await item.store.complete(manual.run.runId, "merged")

    // then
    expect(completion.park.parked).toBe(false)
    expect(await item.store.readPark()).toEqual({ version: 1, streak: 0 })
    expect(existsSync(item.parkPath)).toBe(false)
    item.advance(10 * 60_000)
    expect((await item.store.tryReserve(await automaticRequest(item.journal))).status).toBe("active")
  })

  it("#given a parked identity #when the probe interval elapses #then exactly one automatic probe is admitted and a second request waits", async () => {
    // given
    const item = await fixture()
    await failAutomaticRuns(item, REFLECTION_PARK_NON_RETRYABLE_STREAK, deterministic)
    item.advance(REFLECTION_PARK_PROBE_INTERVAL_MS)

    // when
    const probe = await item.store.tryReserve(await automaticRequest(item.journal))
    expect(probe.status).toBe("active")
    if (probe.status !== "active") throw new Error("unreachable")
    await item.store.complete(probe.run.runId, "failed", { failure: deterministic })
    item.advance(60_000)
    const refused = await item.store.tryReserve(await automaticRequest(item.journal))

    // then
    expect(refused.status).toBe("parked")
    if (refused.status !== "parked") throw new Error("unreachable")
    expect(refused.park.parkedAt).toBeDefined()
    expect(refused.park.streak).toBe(REFLECTION_PARK_NON_RETRYABLE_STREAK + 1)
    expect(Date.parse(refused.nextProbeAt)).toBeGreaterThan(T0)
  })

  it("#given transient failures #when they stay below their threshold #then the journal backoff still applies and nothing is parked", async () => {
    // given
    const item = await fixture()

    // when
    await failAutomaticRuns(item, REFLECTION_PARK_RETRYABLE_STREAK - 1, transient)

    // then
    const park = await item.store.readPark()
    expect(park.parkedAt).toBeUndefined()
    expect(park.streak).toBe(REFLECTION_PARK_RETRYABLE_STREAK - 1)
    expect((await item.journal.getState()).consecutive_failures).toBe(REFLECTION_PARK_RETRYABLE_STREAK - 1)
    expect((await item.journal.getState()).next_eligible_at).toBeDefined()
  })

  it("#given transient failures #when they reach their threshold #then the identity parks", async () => {
    // given
    const item = await fixture()

    // when
    await failAutomaticRuns(item, REFLECTION_PARK_RETRYABLE_STREAK, transient)

    // then
    expect((await item.store.readPark()).parkedAt).toBeDefined()
  })

  it("#given the failure that parks #when completion returns #then it reports the park edge exactly once", async () => {
    // given
    const item = await fixture()
    await failAutomaticRuns(item, REFLECTION_PARK_NON_RETRYABLE_STREAK - 1, deterministic)

    // when
    const reserved = await item.store.tryReserve(await automaticRequest(item.journal))
    if (reserved.status !== "active") throw new Error("expected an active reservation")
    const parking = await item.store.complete(reserved.run.runId, "failed", { failure: deterministic })
    item.advance(REFLECTION_PARK_PROBE_INTERVAL_MS)
    const probe = await item.store.tryReserve(await automaticRequest(item.journal))
    if (probe.status !== "active") throw new Error("expected a probe reservation")
    const stillParked = await item.store.complete(probe.run.runId, "failed", { failure: deterministic })

    // then
    expect(parking.park).toMatchObject({ parked: true, justParked: true })
    expect(stillParked.park).toMatchObject({ parked: true, justParked: false })
  })

  it("#given a manual run fails while parked #when completion returns #then the park is unchanged", async () => {
    // given
    const item = await fixture()
    await failAutomaticRuns(item, REFLECTION_PARK_NON_RETRYABLE_STREAK, deterministic)
    const before = await item.store.readPark()

    // when
    const manual = await item.store.tryReserve({ trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] })
    if (manual.status !== "active") throw new Error("expected an active reservation")
    await item.store.complete(manual.run.runId, "failed", { failure: deterministic })

    // then
    expect(await item.store.readPark()).toEqual(before)
  })

  it("#given an automatic pending request queued behind the failure that parks #when completion promotes #then the pending automatic run is dropped instead of launched", async () => {
    // given
    const item = await fixture()
    await failAutomaticRuns(item, REFLECTION_PARK_NON_RETRYABLE_STREAK - 1, deterministic)
    const reserved = await item.store.tryReserve(await automaticRequest(item.journal))
    if (reserved.status !== "active") throw new Error("expected an active reservation")
    const queued = await item.store.tryReserve(await automaticRequest(item.journal))
    expect(queued.status).toBe("pending")

    // when
    const completion = await item.store.complete(reserved.run.runId, "failed", { failure: deterministic })

    // then
    expect(completion.launch).toBeUndefined()
    expect(await item.store.readState()).toEqual({})
  })

  it.each([
    ["truncated json", "{not json"],
    ["an unsupported shape", JSON.stringify({ version: 2, streak: "many" })],
  ])("#given %s in park.json #when manual and automatic reflections are requested #then both reserve and the next automatic failure rewrites the file", async (_label, corrupt) => {
    // given
    const item = await fixture()
    await mkdir(dirname(item.parkPath), { recursive: true })
    await writeFile(item.parkPath, corrupt)

    // when
    const manual = await item.store.tryReserve({ trigger: "manual", conversationIds: ["conversation-a"], snapshots: [] })
    expect(manual.status).toBe("active")
    if (manual.status !== "active") throw new Error("unreachable")
    await item.store.complete(manual.run.runId, "failed", { failure: deterministic })
    item.advance(60_000)
    const automatic = await item.store.tryReserve(await automaticRequest(item.journal))
    expect(automatic.status).toBe("active")
    if (automatic.status !== "active") throw new Error("unreachable")
    await item.store.complete(automatic.run.runId, "failed", { failure: deterministic })

    // then
    expect(await item.store.readPark()).toMatchObject({ version: 1, streak: 1 })
  })
})
