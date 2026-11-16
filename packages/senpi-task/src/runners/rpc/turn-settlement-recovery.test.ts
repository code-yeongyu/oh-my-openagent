import { describe, expect, test } from "bun:test"
import type { AgentSessionEvent } from "@code-yeongyu/senpi"

import type { RunnerOutcome } from "../in-process/child-handle"
import { createTurnSettlement } from "./turn-settlement"
import { createManualSettlementScheduler, flushSettlement } from "./turn-settlement.test-support"

const COMPACTION_ERROR = "Context remains above the compaction threshold because compaction did not complete"
const CONTINUATION_ERROR = "Failed to continue queued messages: Cannot continue with assistant message"

function fixture() {
  const outcomes: RunnerOutcome[] = []
  const scheduler = createManualSettlementScheduler()
  const settlement = createTurnSettlement({
    settle: (outcome) => outcomes.push(outcome),
    abortedByUser: () => false,
    baseline: () => undefined,
    finalText: () => undefined,
    probe: async () => ({ isStreaming: false, isCompacting: false }),
    settleConfirmMs: 100,
    scheduleConfirmation: scheduler.scheduler,
  })
  return { settlement, scheduler, outcomes }
}

function retryingEnd(): AgentSessionEvent {
  return {
    type: "agent_end",
    willRetry: true,
    messages: [],
  }
}

describe("recovery settlement (omo#13785)", () => {
  test("reports a declined retry when no further agent_end or agent_idle arrives", async () => {
    // given
    const { settlement, scheduler, outcomes } = fixture()
    settlement.observe(retryingEnd())

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
    settlement.observe(retryingEnd())

    // when
    settlement.observe({ type: "continuation_error", errorMessage: CONTINUATION_ERROR })
    settlement.observe({ type: "agent_idle" })

    // then
    expect(outcomes).toEqual([{ status: "error", failure: { kind: "child-turn-failed", message: CONTINUATION_ERROR } }])
  })

  test("does not fail a retry that starts another run", async () => {
    // given
    const { settlement, scheduler, outcomes } = fixture()
    settlement.observe(retryingEnd())

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
    settlement.observe(retryingEnd())
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
