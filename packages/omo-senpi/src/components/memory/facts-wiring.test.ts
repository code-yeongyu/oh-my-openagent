import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  TranscriptJournal,
  buildIdentityPaths,
  type MemoryIdentityPaths,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"

import { createMemoryFactsWiring } from "./facts-wiring"
import { realpathSync } from "node:fs"
import { rmEfaultTolerant } from "./teardown.test-support"

const IDENTITY = "facts-wiring-agent"
const SESSION = "session-alpha"
const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rmEfaultTolerant(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })))
})

async function fixture(): Promise<MemoryIdentityPaths> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-facts-wiring-")))
  tempDirs.push(dir)
  const paths = buildIdentityPaths(join(dir, "memory"), IDENTITY)
  await mkdir(paths.locks, { recursive: true })
  await mkdir(paths.factsQueue, { recursive: true })
  return paths
}

function entry(kind: "user" | "assistant", messageId: string): TranscriptEntry {
  return {
    kind,
    text: `${kind} ${messageId}`,
    captured_at: "2026-01-01T00:00:00.000Z",
    source_line_id: `${messageId}:${kind}`,
    source_message_id: messageId,
  }
}

/** Seeds the real journal so the wiring reads entries through TranscriptJournal. */
async function seedJournal(paths: MemoryIdentityPaths, count: number): Promise<void> {
  const journal = new TranscriptJournal({ journalDir: join(paths.transcripts, SESSION) })
  const entries: TranscriptEntry[] = []
  for (let index = 1; index <= count; index += 1) {
    entries.push(entry("user", `m${index}`), entry("assistant", `m${index}`))
  }
  await journal.append(entries)
}

async function queueFileCount(paths: MemoryIdentityPaths): Promise<number> {
  const names = await readdir(paths.factsQueue).catch(() => [] as string[])
  return names.filter((name) => name.endsWith(".json") && name !== "consumed.json").length
}

function wiringFor(paths: MemoryIdentityPaths, enabled: boolean) {
  return createMemoryFactsWiring({
    identity: IDENTITY,
    identityPaths: paths,
    factsEnabled: () => enabled,
  })
}

describe("facts wiring settle enqueue", () => {
  test("#given debounce four #when four settles complete #then exactly one all-pending extractor launch fires", async () => {
    // given
    const paths = await fixture()
    await seedJournal(paths, 2)
    let launches = 0
    let signalLaunch: (() => void) | undefined
    const launched = new Promise<void>((resolve) => { signalLaunch = resolve })
    const wiring = createMemoryFactsWiring({
      identity: IDENTITY,
      identityPaths: paths,
      factsEnabled: () => true,
      debounceSettles: () => 4,
      extractor: {
        launchPending: async () => {
          launches += 1
          signalLaunch?.()
        },
        reconcilePending: async () => undefined,
      },
    })

    // when
    await wiring.onSettled(SESSION)
    await wiring.onSettled(SESSION)
    await wiring.onSettled(SESSION)
    expect(launches).toBe(0)
    await wiring.onSettled(SESSION)
    await Promise.race([
      launched,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("facts launch did not fire")), 2_000)),
    ])

    // then
    expect(launches).toBe(1)
    expect(await queueFileCount(paths)).toBe(1)
  }, 30_000)

  test("#given facts enabled and a new journal delta #when settle runs #then one queue file is published", async () => {
    // given
    const paths = await fixture()
    await seedJournal(paths, 2)
    const wiring = wiringFor(paths, true)

    // when
    const result = await wiring.enqueueSettled(SESSION)

    // then
    expect(result.enqueued).toBe(true)
    expect(await queueFileCount(paths)).toBe(1)
  }, 30_000)

  test("#given the same cursor #when settle runs twice #then no duplicate entry is published", async () => {
    // given
    const paths = await fixture()
    await seedJournal(paths, 2)
    const wiring = wiringFor(paths, true)
    await wiring.enqueueSettled(SESSION)

    // when
    const duplicate = await wiring.enqueueSettled(SESSION)

    // then
    expect(duplicate.enqueued).toBe(false)
    expect(await queueFileCount(paths)).toBe(1)
  }, 30_000)

  test("#given facts disabled #when settle runs #then nothing is enqueued", async () => {
    // given
    const paths = await fixture()
    await seedJournal(paths, 2)
    const wiring = wiringFor(paths, false)

    // when
    const result = await wiring.enqueueSettled(SESSION)

    // then
    expect(result.enqueued).toBe(false)
    expect(await queueFileCount(paths)).toBe(0)
  }, 30_000)

  test("#given an empty journal #when settle runs #then nothing is enqueued", async () => {
    // given
    const paths = await fixture()
    const wiring = wiringFor(paths, true)

    // when
    const result = await wiring.enqueueSettled(SESSION)

    // then
    expect(result.enqueued).toBe(false)
    expect(await queueFileCount(paths)).toBe(0)
  }, 30_000)

  test("#given a pre-aborted drain signal #when final-delta enqueue is requested #then no journal read or queue mutation starts", async () => {
    const paths = await fixture()
    const controller = new AbortController()
    controller.abort()
    let journalReads = 0
    const wiring = createMemoryFactsWiring({
      identity: IDENTITY,
      identityPaths: paths,
      factsEnabled: () => true,
      createJournal: () => ({
        readEntries: async () => {
          journalReads += 1
          return [entry("user", "m1")]
        },
      }) as unknown as TranscriptJournal,
    })

    const result = await wiring.enqueueSettled(SESSION, controller.signal)

    expect(result.enqueued).toBe(false)
    expect(journalReads).toBe(0)
    expect(await queueFileCount(paths)).toBe(0)
  }, 30_000)

  test("#given abort arrives while the final journal delta is being read #when enqueue reaches the queue boundary #then no queue mutation starts", async () => {
    const paths = await fixture()
    const controller = new AbortController()
    const wiring = createMemoryFactsWiring({
      identity: IDENTITY,
      identityPaths: paths,
      factsEnabled: () => true,
      createJournal: () => ({
        readEntries: async () => {
          controller.abort()
          return [entry("user", "m1")]
        },
      }) as unknown as TranscriptJournal,
    })

    const result = await wiring.enqueueSettled(SESSION, controller.signal)

    expect(result.enqueued).toBe(false)
    expect(await queueFileCount(paths)).toBe(0)
  }, 30_000)
})

describe("facts wiring shutdown launch", () => {
  test("#given a pre-aborted drain signal at a met threshold #when launch is requested #then no extractor spawn starts", async () => {
    const paths = await fixture()
    await seedJournal(paths, 1)
    let launches = 0
    let thresholdReads = 0
    const wiring = createMemoryFactsWiring({
      identity: IDENTITY,
      identityPaths: paths,
      factsEnabled: () => true,
      debounceSettles: () => ++thresholdReads === 1 ? 2 : 1,
      extractor: {
        launchPending: async () => { launches += 1 },
        reconcilePending: async () => undefined,
      },
    })
    await wiring.onSettled(SESSION)
    const controller = new AbortController()
    controller.abort()

    const launched = await wiring.launchIfThresholdMet(controller.signal)

    expect(launched).toBe(false)
    expect(launches).toBe(0)
  }, 30_000)

  test("#given abort arrives during the threshold probe #when launch reaches the extractor boundary #then no extractor spawn starts", async () => {
    const paths = await fixture()
    await seedJournal(paths, 1)
    const controller = new AbortController()
    let launches = 0
    let thresholdReads = 0
    const wiring = createMemoryFactsWiring({
      identity: IDENTITY,
      identityPaths: paths,
      factsEnabled: () => true,
      debounceSettles: () => {
        thresholdReads += 1
        if (thresholdReads === 2) {
          controller.abort()
          return 1
        }
        return 2
      },
      extractor: {
        launchPending: async () => { launches += 1 },
        reconcilePending: async () => undefined,
      },
    })
    await wiring.onSettled(SESSION)

    const launched = await wiring.launchIfThresholdMet(controller.signal)

    expect(launched).toBe(false)
    expect(launches).toBe(0)
  }, 30_000)
})

describe("facts wiring session_start reconcile", () => {
  test("#given a leftover queue file from a crashed run #when reconcile runs #then it is reported launchable", async () => {
    // given: a settle published an entry that no extractor ever consumed
    const paths = await fixture()
    await seedJournal(paths, 2)
    await wiringFor(paths, true).enqueueSettled(SESSION)

    // when: a fresh session starts and reconciles the durable queue
    const recovered = wiringFor(paths, true)
    const launchable = await recovered.reconcilePending()

    // then
    expect(launchable).toHaveLength(1)
    expect(launchable[0]?.conversationId).toBe(SESSION)
    expect(launchable[0]?.range.end_message_id).toBe("m2")
  }, 30_000)

  test("#given facts disabled #when reconcile runs #then no leftover work is reported", async () => {
    // given
    const paths = await fixture()
    await seedJournal(paths, 2)
    await wiringFor(paths, true).enqueueSettled(SESSION)

    // when
    const launchable = await wiringFor(paths, false).reconcilePending()

    // then
    expect(launchable).toHaveLength(0)
  }, 30_000)

  test("#given a consumed batch #when reconcile runs #then nothing is left to relaunch", async () => {
    // given
    const paths = await fixture()
    await seedJournal(paths, 2)
    const wiring = wiringFor(paths, true)
    await wiring.enqueueSettled(SESSION)

    // when
    await wiring.markConsumed(await wiring.reconcilePending())

    // then
    expect(await wiring.reconcilePending()).toHaveLength(0)
    expect(await queueFileCount(paths)).toBe(0)
  }, 30_000)
})
