import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

import {
  FactsFailureStore,
  MAX_FACTS_PAYLOAD_BYTES,
  factsQueuePaths,
  type FactsQueue,
  type MemoryIdentity,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"

import { FactsExtractorRunner, type FactsExtractorRunnerOptions } from "./facts-runner"
import { enqueue, fixture, onlyRunDir, runnerOptions } from "./facts-runner.test-support"
import type { FactsRunLedger } from "./facts-runner-types"

const NOW = new Date("2026-08-16T12:00:00.000Z")

/** A single transcript entry whose own payload (envelope + [entry]) cannot fit the cap. */
function oversizeText(): string {
  return "z".repeat(MAX_FACTS_PAYLOAD_BYTES + 4_096)
}

function message(messageId: string, text: string): TranscriptEntry {
  const captured_at = "2026-08-16T00:00:00.000Z"
  return { kind: "user", text, captured_at, source_line_id: `${messageId}:user`, source_message_id: messageId }
}

async function publish(
  queue: FactsQueue,
  identity: MemoryIdentity,
  conversationId: string,
  transcript: readonly TranscriptEntry[],
): Promise<void> {
  await queue.enqueue({ identity: identity.id, sessionId: conversationId, conversationId, entries: transcript })
}

/** Bloats the FIXED envelope: people cards are read into every payload before entries are chosen. */
async function bloatPeoplePayload(identity: MemoryIdentity): Promise<void> {
  const cardDir = join(identity.paths.repo, "people", "bulky")
  await mkdir(cardDir, { recursive: true })
  const aliases = Array.from({ length: 64 }, (_, index) => `alias-${index}-${"w".repeat(2_048)}`)
  await writeFile(
    join(cardDir, "card.md"),
    `---\ndescription: Person - Bulky\nkind: person\naliases: ${JSON.stringify(aliases)}\n---\n\n# Bulky\n`,
    "utf8",
  )
}

function warnCollector() {
  const warnings: { readonly message: string; readonly fields: Record<string, unknown> }[] = []
  const warn = (message: string, fields?: unknown) =>
    warnings.push({ message, fields: (fields ?? {}) as Record<string, unknown> })
  return { warnings, logger: { info: () => undefined, warn, error: () => undefined } }
}

/** Batch files only: `consumed.json`/`failures.json` are state, not queued data. */
async function queueFileNames(identity: MemoryIdentity): Promise<string[]> {
  const layout = factsQueuePaths(identity.paths)
  return (await readdir(layout.queueDir).catch(() => []))
    .filter((name) => name.endsWith(".json") && name !== "consumed.json" && name !== "failures.json")
    .sort()
}

/** One launch attempt against the real runner at an injected instant. */
function launch(
  root: string,
  identity: MemoryIdentity,
  queue: FactsQueue,
  overrides: Partial<FactsExtractorRunnerOptions> = {},
) {
  return new FactsExtractorRunner(runnerOptions(root, identity, queue, "fact", { now: () => NOW, ...overrides }))
    .launchPending()
}

describe("facts oversize payload classification", () => {
  test("#given one entry larger than the whole cap #when a launch runs #then it parks immediately while other conversations still ship", async () => {
    // given: session-1 (small, from the fixture) plus an oversize session-2 entry.
    const { root, identity, queue } = await fixture()
    await publish(queue, identity, "session-2", [message("m2", oversizeText())])
    expect(await queueFileNames(identity)).toHaveLength(2)

    // when
    const result = await launch(root, identity, queue)

    // then: the healthy conversation launched, the oversize one is parked in the REAL store.
    expect(result.status).toBe("committed")
    const ledger = JSON.parse(
      await readFile(join(await onlyRunDir(identity), "ledger.json"), "utf8"),
    ) as FactsRunLedger
    expect(ledger.queued.map((key) => key.conversationId)).toEqual(["session-1"])
    const state = await new FactsFailureStore({ identityPaths: identity.paths }).readFailures()
    expect(state.entries).toHaveLength(1)
    expect(state.entries[0]).toMatchObject({
      conversationId: "session-2",
      end_message_id: "m2",
      state: "parked",
      streak: 1,
      lastReason: "payload_entry_oversize",
      nextEligibleAt: null,
    })
    expect(state.entries[0]?.parkedAt).toBe(NOW.toISOString())
    expect(state.entries[0]?.lastFailureId).toMatch(/^preflight-[0-9a-f-]{36}$/)
    // LOSSLESS: the oversize entry's queue file survives; only the shipped one is consumed.
    expect(await queueFileNames(identity)).toHaveLength(1)
    expect((await queue.listPending()).map((entry) => entry.conversationId)).toEqual(["session-2"])
  }, 30_000)

  test("#given a parked oversize entry #when the same conversation queues a newer entry #then the newer entry stays blocked while others flow", async () => {
    // given: an oversize entry parks, then the same conversation grows.
    const { root, identity, queue } = await fixture()
    await publish(queue, identity, "session-2", [message("m2", oversizeText())])
    await launch(root, identity, queue)
    const store = new FactsFailureStore({ identityPaths: identity.paths })
    expect((await store.readFailures()).entries).toMatchObject([{ conversationId: "session-2", state: "parked" }])
    await publish(queue, identity, "session-2", [message("m2", oversizeText()), message("m3", "Small tail.")])
    await enqueue(queue, identity, "session-3", "m4", "The project uses Bun.")

    // when
    const result = await launch(root, identity, queue, { now: () => new Date(NOW.getTime() + 60_000) })

    // then: session-2's newer entry is blocked by its parked predecessor; session-3 flows.
    expect(result.status).toBe("committed")
    const runs = (await readdir(join(identity.paths.facts, "runs"))).sort()
    const latest = JSON.parse(
      await readFile(join(identity.paths.facts, "runs", runs[runs.length - 1] ?? "missing", "ledger.json"), "utf8"),
    ) as FactsRunLedger
    expect(latest.queued.map((key) => key.conversationId)).toEqual(["session-3"])
    expect((await queue.listPending()).map((entry) => entry.range.end_message_id).sort()).toEqual(["m2", "m3"])
  }, 30_000)

  test("#given a people payload larger than the cap #when a launch runs #then nothing launches, frontiers take a normal streak, and the warning names bytes vs cap", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await enqueue(queue, identity, "session-2", "m2", "The project uses TypeScript.")
    await bloatPeoplePayload(identity)
    const collector = warnCollector()

    // when
    const result = await launch(root, identity, queue, { logger: collector.logger })

    // then: no run dir, and both frontiers carry a NORMAL streak (backoff, not park).
    expect(result.status).toBe("skipped")
    expect(existsSync(join(identity.paths.facts, "runs"))).toBe(false)
    const state = await new FactsFailureStore({ identityPaths: identity.paths }).readFailures()
    expect(state.entries.map((record) => record.conversationId).sort()).toEqual(["session-1", "session-2"])
    for (const record of state.entries) {
      expect(record).toMatchObject({ state: "backoff", streak: 1, lastReason: "payload_envelope_oversize" })
      expect(record.nextEligibleAt).toBe(new Date(NOW.getTime() + 60_000).toISOString())
    }
    const warning = collector.warnings.find((entry) => entry.message.includes("envelope"))
    expect(warning).toBeDefined()
    expect(warning?.fields.envelopeBytes).toBeGreaterThan(MAX_FACTS_PAYLOAD_BYTES)
    expect(warning?.fields.maxBytes).toBe(MAX_FACTS_PAYLOAD_BYTES)
    expect(await queue.listPending()).toHaveLength(2)
  }, 30_000)

  test("#given an oversize park #when /facts retry clears the record #then the entry is launchable again and re-parks while still oversize", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await publish(queue, identity, "session-2", [message("m2", oversizeText())])
    const store = new FactsFailureStore({ identityPaths: identity.paths, now: () => NOW })
    await launch(root, identity, queue)
    expect((await store.readFailures()).entries[0]).toMatchObject({ state: "parked" })

    // when: the manual unpark path clears it, and the entry is attempted again unchanged.
    const removed = await store.clearForRetry({ conversationId: "session-2" })
    const afterRetry = await store.readFailures()
    const relaunch = await launch(root, identity, queue, { now: () => new Date(NOW.getTime() + 60_000) })

    // then: retry restores launchability; the unchanged oversize entry parks again, losslessly.
    expect(removed).toBe(1)
    expect(afterRetry.entries).toEqual([])
    expect(relaunch.status).toBe("empty")
    const reparked = await store.readFailures()
    expect(reparked.entries).toHaveLength(1)
    expect(reparked.entries[0]).toMatchObject({
      conversationId: "session-2",
      state: "parked",
      streak: 1,
      lastReason: "payload_entry_oversize",
      nextEligibleAt: null,
    })
    expect((await queue.listPending()).map((entry) => entry.conversationId)).toEqual(["session-2"])
  }, 30_000)

  test("#given only oversize work #when classification runs #then no queue file, watermark, or run dir is written", async () => {
    // given: a single oversize entry and no healthy conversation beside it.
    const { root, identity, queue } = await fixture()
    const layout = factsQueuePaths(identity.paths)
    await launch(root, identity, queue)
    await publish(queue, identity, "session-2", [message("m2", oversizeText())])
    const filesBefore = await queueFileNames(identity)
    const consumedBefore = await readFile(layout.consumedPath, "utf8")

    // when
    const result = await launch(root, identity, queue, { now: () => new Date(NOW.getTime() + 60_000) })

    // then: the classification is ledger-only - no queue file, watermark, or run dir moves.
    expect(result.status).toBe("empty")
    expect(await queueFileNames(identity)).toEqual(filesBefore)
    expect(await readFile(layout.consumedPath, "utf8")).toBe(consumedBefore)
    expect((await readdir(join(identity.paths.facts, "runs"))).length).toBe(1)
    const state = await new FactsFailureStore({ identityPaths: identity.paths }).readFailures()
    expect(state.entries).toMatchObject([{ conversationId: "session-2", state: "parked", streak: 1 }])
  }, 30_000)
})
