import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  MAX_FACTS_PAYLOAD_BYTES,
  factsQueuePaths,
  measureFactsPayloadBytes,
  serializeFactsPayload,
  type FactsConsumedWatermark,
  type FactsPayload,
  type FactsQueue,
  type MemoryIdentity,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"

import { FactsExtractorRunner } from "./facts-runner"
import { fixture, runLedgers, runnerOptions } from "./facts-runner.test-support"
import type { FactsRunLedger } from "./facts-runner-types"
import { prepareFactsSpawn } from "./worker/spawn"

const NOW = new Date("2026-08-16T12:00:00.000Z")

/** One transcript entry big enough that two of them cannot share a single capped payload. */
function bulk(): string {
  return "y".repeat(Math.floor(MAX_FACTS_PAYLOAD_BYTES * 0.7))
}

function message(messageId: string, text: string): TranscriptEntry {
  return {
    kind: "user",
    text,
    captured_at: "2026-08-16T00:00:00.000Z",
    source_line_id: `${messageId}:user`,
    source_message_id: messageId,
  }
}

/**
 * Publishes one batch per call over a GROWING transcript, so successive entries of the same
 * conversation carry strictly increasing `end_snapshot_line` - the ordering frame prefix
 * closure is defined on.
 */
async function publish(
  queue: FactsQueue,
  identity: MemoryIdentity,
  conversationId: string,
  transcript: readonly TranscriptEntry[],
): Promise<void> {
  await queue.enqueue({
    identity: identity.id,
    sessionId: conversationId,
    conversationId,
    entries: transcript,
  })
}

describe("facts payload byte cap", () => {
  test("#given a prepared facts spawn #when its payload file is read #then the bytes equal the shared measurement", async () => {
    // given
    const { root } = await fixture()
    const payload: FactsPayload = {
      version: 1,
      identity: "facts-agent",
      today: "2026-08-16",
      entries: [],
      knownPeople: [{ slug: "ada", displayName: "Ada", aliases: ["Ada L. ☕"] }],
      primaryHuman: { slug: "human", aliases: ["보스"] },
    }

    // when
    const prepared = await prepareFactsSpawn({
      runId: "facts-cap-1",
      runDir: join(root, "cap-run"),
      payload,
      model: "provider/model",
      env: {},
    })
    const written = await readFile(prepared.paths.payload, "utf8")

    // then: the writer and the cap measurement share ONE serializer.
    expect(written).toBe(serializeFactsPayload(payload))
    expect(Buffer.byteLength(written, "utf8")).toBe(measureFactsPayloadBytes(payload))
  }, 30_000)

  test("#given a backlog larger than the cap #when a launch runs #then the payload stays within the cap and only shipped endpoints are consumed", async () => {
    // given: two bulk conversations that cannot share one capped payload.
    const { root, identity, queue } = await fixture()
    await publish(queue, identity, "session-2", [message("m2", bulk())])
    await publish(queue, identity, "session-3", [message("m3", bulk())])

    // when: the sandbox seam observes each payload file before the terminal write deletes it.
    const options = runnerOptions(root, identity, queue, "fact", { now: () => NOW })
    const payloadBytes: number[] = []
    const result = await new FactsExtractorRunner({
      ...options,
      sandbox: (args) => {
        payloadBytes.push(Buffer.byteLength(readFileSync(args.paths.payload, "utf8"), "utf8"))
        return options.sandbox?.(args) ?? args
      },
    }).launchPending()

    // then: the drain splits the backlog into capped runs, every one of them within the cap.
    expect(result.status).toBe("committed")
    const ledgers = await runLedgers(identity)
    expect(ledgers).toHaveLength(2)
    // Only one bulk conversation fits beside the small one; the newest bulk wins the budget.
    expect(ledgers[0]?.queued.map((key) => key.conversationId).sort()).toEqual(["session-1", "session-3"])
    expect(ledgers[1]?.queued.map((key) => key.conversationId)).toEqual(["session-2"])
    expect(payloadBytes).toHaveLength(2)
    for (const bytes of payloadBytes) {
      expect(bytes).toBeGreaterThan(0)
      expect(bytes).toBeLessThanOrEqual(MAX_FACTS_PAYLOAD_BYTES)
    }
    const consumed = JSON.parse(
      await readFile(factsQueuePaths(identity.paths).consumedPath, "utf8"),
    ) as FactsConsumedWatermark
    expect(Object.keys(consumed.consumed).sort()).toEqual(["session-1", "session-2", "session-3"])
    expect(await queue.listPending()).toHaveLength(0)
  }, 60_000)

  test("#given a conversation whose older entry is unconsumed #when the cap forbids both #then neither ships and the watermark stays put", async () => {
    // given: session-1 carries three entries; prefix closure forbids shipping only newer ones.
    const { root, identity, queue } = await fixture()
    const first = message("m1", "The project uses Bun.")
    const second = message("m2", bulk())
    await publish(queue, identity, "session-1", [first, second])
    await publish(queue, identity, "session-1", [first, second, message("m3", bulk())])

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => NOW }),
    ).launchPending()

    // then: the closed prefix m1+m2 ships first; m3 cannot join it, so the drain ships it next.
    expect(result.status).toBe("committed")
    const ledgers = await runLedgers(identity)
    expect(ledgers.map((ledger) => ledger.queued.map((key) => key.end_message_id))).toEqual([["m1", "m2"], ["m3"]])
    const consumed = JSON.parse(
      await readFile(factsQueuePaths(identity.paths).consumedPath, "utf8"),
    ) as FactsConsumedWatermark
    expect(consumed.consumed["session-1"]?.end_message_id).toBe("m3")
    expect(await queue.listPending()).toHaveLength(0)
  }, 60_000)
})
