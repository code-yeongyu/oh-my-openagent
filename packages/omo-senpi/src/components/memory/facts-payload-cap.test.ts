import { describe, expect, test } from "bun:test"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import {
  MAX_FACTS_PAYLOAD_BYTES,
  factsQueuePaths,
  serializeFactsPayload,
  type FactsConsumedWatermark,
  type FactsPayload,
  type FactsQueue,
  type MemoryIdentity,
  type TranscriptEntry,
} from "@oh-my-opencode/memory-core"
import type { ChildSpec } from "@oh-my-opencode/senpi-task"

import { FactsExtractorRunner } from "./facts-runner"
import { fixture, runLedgers, runnerOptions } from "./facts-runner.test-support"

const NOW = new Date("2026-08-16T12:00:00.000Z")

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

async function publish(
  queue: FactsQueue,
  identity: MemoryIdentity,
  conversationId: string,
  transcript: readonly TranscriptEntry[],
): Promise<void> {
  await queue.enqueue({ identity: identity.id, sessionId: conversationId, conversationId, entries: transcript })
}

describe("facts payload byte cap", () => {
  test("#given a launched facts run #when facts-payload.json is read #then its bytes equal serializeFactsPayload(payload) and equal the inlined prompt payload", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const filePayloads: string[] = []
    const promptPayloads: string[] = []
    const base = runnerOptions(root, identity, queue, "fact", { now: () => NOW })
    const create = base.createRunner
    if (create === undefined) throw new Error("facts test runner must provide an in-process runner")
    const runner = new FactsExtractorRunner({
      ...base,
      createRunner: (options) => {
        const real = create(options)
        return {
          start: async (spec: ChildSpec) => {
            const payload = await readFile(join(spec.cwd, "facts-payload.json"), "utf8")
            filePayloads.push(payload)
            promptPayloads.push(spec.prompt.slice(spec.prompt.indexOf("\n\n") + 2))
            return real.start(spec)
          },
        }
      },
    })

    // when
    const result = await runner.launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(filePayloads).toHaveLength(1)
    const payload = JSON.parse(filePayloads[0] ?? "null") as FactsPayload
    expect(filePayloads[0]).toBe(serializeFactsPayload(payload))
    expect(filePayloads[0]).toBe(promptPayloads[0])
  }, 60_000)

  test("#given a backlog larger than the cap #when a launch runs #then the payload stays within the cap and only shipped endpoints are consumed", async () => {
    // given
    const { root, identity, queue } = await fixture()
    await publish(queue, identity, "session-2", [message("m2", bulk())])
    await publish(queue, identity, "session-3", [message("m3", bulk())])
    const payloads: string[] = []
    const base = runnerOptions(root, identity, queue, "fact", { now: () => NOW })
    const create = base.createRunner
    if (create === undefined) throw new Error("facts test runner must provide an in-process runner")
    const result = await new FactsExtractorRunner({
      ...base,
      createRunner: (options) => {
        const real = create(options)
        return {
          start: async (spec: ChildSpec) => {
            payloads.push(await readFile(join(spec.cwd, "facts-payload.json"), "utf8"))
            return real.start(spec)
          },
        }
      },
    }).launchPending()

    // then
    expect(result.status).toBe("committed")
    expect(payloads.every((payload) => Buffer.byteLength(payload, "utf8") <= MAX_FACTS_PAYLOAD_BYTES)).toBe(true)
    const ledgers = await runLedgers(identity)
    expect(ledgers).toHaveLength(2)
    expect(ledgers[0]?.queued.map((key) => key.conversationId).sort()).toEqual(["session-1", "session-3"])
    expect(ledgers[1]?.queued.map((key) => key.conversationId)).toEqual(["session-2"])
    const consumed = JSON.parse(await readFile(factsQueuePaths(identity.paths).consumedPath, "utf8")) as FactsConsumedWatermark
    expect(Object.keys(consumed.consumed).sort()).toEqual(["session-1", "session-2", "session-3"])
  }, 60_000)

  test("#given a conversation whose older entry is unconsumed #when the cap forbids both #then neither ships and the watermark stays put", async () => {
    // given
    const { root, identity, queue } = await fixture()
    const older = message("m2", "y".repeat(MAX_FACTS_PAYLOAD_BYTES))
    await publish(queue, identity, "session-2", [older])
    await publish(queue, identity, "session-2", [older, message("m3", "The newer entry cannot bypass its older sibling.")])

    // when
    const result = await new FactsExtractorRunner(
      runnerOptions(root, identity, queue, "fact", { now: () => NOW }),
    ).launchPending()

    // then
    expect(result.status).toBe("committed")
    const ledgers = await runLedgers(identity)
    expect(ledgers).toHaveLength(1)
    expect(ledgers[0]?.queued.map((key) => key.conversationId)).toEqual(["session-1"])
    const consumed = JSON.parse(await readFile(factsQueuePaths(identity.paths).consumedPath, "utf8")) as FactsConsumedWatermark
    expect(consumed.consumed["session-2"]).toBeUndefined()
    expect((await queue.listPending()).map((entry) => entry.conversationId)).toContain("session-2")
  }, 60_000)
})
