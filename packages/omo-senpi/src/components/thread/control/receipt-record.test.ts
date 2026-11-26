import { describe, expect, test } from "bun:test"

import type { ThreadToolResult } from "../contracts"
import { withGuidance } from "../refusal-texts"
import { queuedPromptGuidance } from "./prompt-guidance"
import { decodeResult, encodeResult } from "./receipt-record"

const INPUT = { thread: "dur-on-b", prompt: "carry on", idempotency_key: "create-wake-1" }

function createAnswer(delivery: Readonly<Record<string, unknown>>): ThreadToolResult {
  const queued = queuedPromptGuidance(delivery, "dur-on-b", "b")
  if (queued === undefined) throw new Error("the delivery is not one waiting on the thread's wake")
  const prompt = withGuidance({ delivery, deduplicated: false }, "next_action", queued.id, queued.slots)
  return { kind: "ok", thread: "dur-on-b", device: "b", prompt } as unknown as ThreadToolResult
}

const QUEUED = { kind: "queued", queue_position: 1, waiting_on: { kind: "wake", device: "b" } }

describe("a queued prompt's guidance in a create's receipt (#14951)", () => {
  test("#given a create whose prompt waits on its thread's wake #when its receipt is replayed #then the guidance is present, byte-equal to the first answer, and the record holds its template, not the sentence", () => {
    const first = createAnswer(QUEUED)
    const record = encodeResult("thread_create", first, INPUT)

    expect(JSON.stringify(record)).not.toContain("runs when")
    const again = decodeResult(record, INPUT) as { prompt?: { next_action?: string } }
    const sentence = (first as unknown as { prompt: { next_action: string } }).prompt.next_action
    expect(again.prompt?.next_action).toBe(sentence)
    expect(again as unknown).toEqual(first)
  })

  test("#given the kind function reports a delivery other than queued #when the receipt is replayed #then the guidance is not the sentence about the thread waking", () => {
    const record = encodeResult("thread_create", createAnswer(QUEUED), INPUT) as {
      prompt: { delivery: Record<string, unknown> }
    }
    // The kind function answers the recorded kind today; slice D1 (#14941) makes it ask the holder, which can report the
    // prompt started since the first answer.
    record.prompt.delivery = { kind: "started", turn_id: "turn-b" }

    const again = decodeResult(record, INPUT) as { prompt?: { next_action?: string } }
    expect(again.prompt).toMatchObject({ delivery: { kind: "started" } })
    expect(again.prompt?.next_action ?? "").not.toContain("runs when dur-on-b wakes")
  })
})
