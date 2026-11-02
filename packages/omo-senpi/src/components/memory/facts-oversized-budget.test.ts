import { expect, test } from "bun:test"
import { serializeFactsPayload, type FactsPayload } from "@oh-my-opencode/memory-core"

import { admitOversizedFacts, FACTS_OVERSIZED_BYTES, factsContextFits } from "./facts-oversized-budget"
import { enqueue, fixture } from "./facts-runner.test-support"

test("#given complete Unicode and escaped oversized source #when admitted #then bytes and the full envelope count without changing input", async () => {
  const { identity, queue } = await fixture()
  await queue.markConsumed(await queue.listPending())
  await enqueue(queue, identity, "large", "last", 'é🌍\\"\n'.repeat(20_000))
  const payload: FactsPayload = { version: 1, identity: identity.id, today: "2026-08-10", entries: await queue.listPending(), knownPeople: [], primaryHuman: { slug: "human", aliases: [] } }
  const before = serializeFactsPayload(payload)
  const model = { contextWindow: 1_048_576, maxTokens: 8192 }
  expect(Buffer.byteLength(before)).toBeGreaterThan(131_072)
  expect(admitOversizedFacts(payload, model)).toBe(true)
  expect(admitOversizedFacts(payload, { ...model, contextWindow: Buffer.byteLength(before) })).toBe(false)
  expect(admitOversizedFacts(payload, { ...model, maxTokens: 0 })).toBe(false)
  expect(admitOversizedFacts(payload, undefined)).toBe(false)
  expect(admitOversizedFacts({ ...payload, entries: [...payload.entries, ...payload.entries] }, model)).toBe(false)
  expect(admitOversizedFacts({ ...payload, primaryHuman: { slug: "human", aliases: ["x".repeat(FACTS_OVERSIZED_BYTES)] } }, model)).toBe(false)
  expect(serializeFactsPayload(payload)).toBe(before)
})

test("#given provider context growth or unknown capacity #when checking admission #then full messages and tools plus output reserve must fit", () => {
  const model = { contextWindow: 20_000, maxTokens: 4096 }
  expect(factsContextFits({ messages: [], tools: [] }, model)).toBe(true)
  expect(factsContextFits({ messages: [{ content: "x".repeat(10_000) }] }, model)).toBe(false)
  expect(factsContextFits({ tools: [{ parameters: "x".repeat(10_000) }] }, model)).toBe(false)
  expect(factsContextFits({}, { ...model, contextWindow: NaN })).toBe(false)
  expect(factsContextFits({}, { ...model, contextWindow: Infinity })).toBe(false)
})
