import { describe, expect, test } from "bun:test"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import type { RunnerOutcome } from "../in-process/child-handle"
import { createTurnSettlement } from "./turn-settlement"
import { createManualSettlementScheduler, flushSettlement } from "./turn-settlement.test-support"

const COMPACTION_ERROR = "Context remains above the compaction threshold because compaction did not complete"
const CONTINUATION_ERROR = "Failed to continue queued messages: Cannot continue with assistant message"

function fixture(wakeSourcesLive: () => boolean = () => false) {
  const outcomes: RunnerOutcome[] = []
  const scheduler = createManualSettlementScheduler()
  const settlement = createTurnSettlement({
    settle: (outcome) => outcomes.push(outcome),
    abortedByUser: () => false,
    baseline: () => undefined,
    finalText: () => undefined,
    probe: async () => ({ isStreaming: false, isCompacting: false }),
    wakeSourcesLive,
    settleConfirmMs: 100,
    scheduleConfirmation: scheduler.scheduler,
  })
  return { settlement, scheduler, outcomes }
}

function turnEnd(willRetry = true): AgentSessionEvent {
  return {
    type: "agent_end",
    willRetry,
    messages: [
      {
        role: "assistant",
        content: willRetry ? [] : [{ type: "text", text: "done" }],
        api: "anthropic-messages",
        provider: "synthetic",
        model: "primary",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: willRetry ? "error" : "stop",
        ...(willRetry ? { errorMessage: COMPACTION_ERROR } : {}),
        timestamp: 1,
      },
    ],
  }
}

describe("recovery settlement (omo#13785)", () => {
  test("settles a completed turn while a session-lifetime monitor remains armed", () => {
    // given
    const { settlement, outcomes } = fixture(() => true)
    settlement.observe(turnEnd(false))

    // when
    settlement.observe({ type: "agent_idle" })

    // then
    expect(outcomes).toEqual([{ status: "completed", finalResponse: "done" }])
  })

  test("settles the original retrying error when recovery becomes idle without a retry-end event", () => {
    // given
    const { settlement, outcomes } = fixture()
    settlement.observe(turnEnd())

    // when
    settlement.observe({ type: "agent_idle" })

    // then
    expect(outcomes).toEqual([{ status: "error", failure: { kind: "child-turn-failed", message: COMPACTION_ERROR } }])
  })

  test("does not settle a retrying error at idle while a continuation wake source is live", () => {
    // given
    let live = true
    const { settlement, outcomes } = fixture(() => live)
    settlement.observe(turnEnd())

    // when
    settlement.observe({ type: "agent_idle" })
    expect(outcomes).toEqual([])
    settlement.observe({ type: "agent_start" })
    live = false
    settlement.observe({ type: "agent_idle" })

    // then
    expect(outcomes).toEqual([])
  })

  test("does not arm terminal confirmation for a retry that still owns recovery", () => {
    // given
    const { settlement, scheduler, outcomes } = fixture()
    settlement.observe(turnEnd())

    // when
    settlement.reconfirmHeld()

    // then
    expect(scheduler.pending()).toBe(0)
    expect(outcomes).toEqual([])
  })

  test("keeps failed recovery owned by its wake source until a new run completes", () => {
    // given
    const { settlement, outcomes } = fixture(() => true)
    settlement.observe(turnEnd())
    settlement.observe({ type: "auto_retry_end", success: false, attempt: 1, finalError: COMPACTION_ERROR })

    // when
    settlement.observe({ type: "agent_idle" })
    expect(outcomes).toEqual([])
    settlement.observe({ type: "agent_start" })
    settlement.observe(turnEnd(false))
    settlement.observe({ type: "agent_idle" })

    // then
    expect(outcomes).toEqual([{ status: "completed", finalResponse: "done" }])
  })

  test("reports a declined retry when no further agent_end or agent_idle arrives", async () => {
    // given
    const { settlement, scheduler, outcomes } = fixture()
    settlement.observe(turnEnd())

    // when
    settlement.observe({ type: "auto_retry_end", success: false, attempt: 1, finalError: COMPACTION_ERROR })

    // then
    expect(scheduler.pending()).toBe(1)
    scheduler.runNext()
    await flushSettlement()
    expect(outcomes).toEqual([{ status: "error", failure: { kind: "child-turn-failed", message: COMPACTION_ERROR } }])
  })

  test("reports a continuation rejection without relying on a second agent_end", () => {
    // given
    const { settlement, outcomes } = fixture()
    settlement.observe(turnEnd())

    // when
    settlement.observe({ type: "continuation_error", errorMessage: CONTINUATION_ERROR })
    settlement.observe({ type: "agent_idle" })

    // then
    expect(outcomes).toEqual([{ status: "error", failure: { kind: "child-turn-failed", message: CONTINUATION_ERROR } }])
  })

  test("preserves the announced error when the declined retry omits finalError", async () => {
    // given
    const { settlement, scheduler, outcomes } = fixture()
    settlement.observe(turnEnd())

    // when
    settlement.observe({ type: "auto_retry_end", success: false, attempt: 1 })
    scheduler.runNext()
    await flushSettlement()

    // then
    expect(outcomes).toEqual([{ status: "error", failure: { kind: "child-turn-failed", message: COMPACTION_ERROR } }])
  })

  test("does not fail a retry that starts another run", async () => {
    // given
    const { settlement, scheduler, outcomes } = fixture()
    settlement.observe(turnEnd())

    // when
    settlement.observe({ type: "auto_retry_end", success: true, attempt: 1 })
    settlement.observe({ type: "agent_start" })
    settlement.observe({ type: "agent_idle" })
    await flushSettlement()

    // then
    expect(scheduler.pending()).toBe(0)
    expect(outcomes).toEqual([])
  })

  test("drops a held recovery failure if a continuation takes over", async () => {
    // given
    const { settlement, scheduler, outcomes } = fixture()
    settlement.observe(turnEnd())
    settlement.observe({ type: "auto_retry_end", success: false, attempt: 1, finalError: COMPACTION_ERROR })

    // when
    settlement.observe({ type: "agent_start" })
    settlement.observe({ type: "agent_idle" })
    await flushSettlement()

    // then
    expect(scheduler.pending()).toBe(0)
    expect(outcomes).toEqual([])
  })
})
