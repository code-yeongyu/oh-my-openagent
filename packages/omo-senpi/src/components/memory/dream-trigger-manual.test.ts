import { describe, expect, test } from "bun:test"
import { createShutdownDrain } from "./shutdown-drain"
import { DREAM_VOLUME_GATE_BYTES, evaluateDreamGates, resolveDreamTriggerSettings } from "./dream-trigger"
import { memorySettings } from "./memory.test-support"
import { CONVERSATION, NOW_MS, fireTimer, fixture, gateProbe, noopSteps, settle, triggerSettings, writeConversation } from "./dream-trigger.test-support"

describe("manual dream origin", () => {
  test("#given a fresh sub-floor transcript and a recent dream #when a manual dream is requested #then it launches past every gate", async () => {
    const f = await fixture({
      conversationText: "hello memory",
      lastDreamAt: new Date(NOW_MS - 3_600_000).toISOString(),
    })
    const outcome = await f.wiring.requestManualDream()
    expect(outcome).toEqual({ fired: true, runId: "run-1", status: "active" })
    expect(f.launches).toHaveLength(1)
    expect(f.launches[0]?.request.trigger).toBe("dream")
    expect(f.launches[0]?.request.origin).toBe("manual")
    expect(f.launches[0]?.request.conversationIds).toEqual([CONVERSATION])
  })

  test("#given dream disabled #when a manual dream is requested #then it still launches", async () => {
    const f = await fixture({ settings: { enabled: false } })
    const outcome = await f.wiring.requestManualDream()
    expect(outcome.fired).toBe(true)
    expect(f.launches[0]?.request.origin).toBe("manual")
  })

  test("#given explicit conversation ids #when a manual dream is requested #then those conversations are reserved", async () => {
    const f = await fixture({ conversationText: null })
    await writeConversation(f.identity.paths.transcripts, "conversation-b", "second conversation")
    const outcome = await f.wiring.requestManualDream({
      conversationIds: ["conversation-b"],
      targetDoc: "reference/style.md",
    })
    expect(outcome).toEqual({ fired: true, runId: "run-1", status: "active" })
    expect(f.launches[0]?.request.conversationIds).toEqual(["conversation-b"])
    expect(f.launches[0]?.request.snapshots).toHaveLength(1)
    expect(f.launches[0]?.request.targetDoc).toBe("reference/style.md")
  })

  test("#given no unreflected content anywhere #when a manual dream is requested #then it declines to reserve", async () => {
    const f = await fixture({ conversationText: null })
    const outcome = await f.wiring.requestManualDream()
    expect(outcome).toEqual({ fired: false, rejection: "no_unreflected_content" })
    expect(f.launches).toHaveLength(0)
    expect(await f.store.readState()).toEqual({})
  })
})

describe("dream reservation integration", () => {
  test("#given an active reflection run #when the idle timer fires #then the dream queues as pending and does not launch", async () => {
    const f = await fixture()
    await f.store.tryReserve({ trigger: "manual", conversationIds: ["other"], snapshots: [] })
    await settle(f)
    await fireTimer(f)
    expect(f.launches).toHaveLength(0)
    const state = await f.store.readState()
    expect(state.active?.request.trigger).toBe("manual")
    expect(state.pending?.request.trigger).toBe("dream")
    expect(state.pending?.request.origin).toBe("idle")
  })
})
