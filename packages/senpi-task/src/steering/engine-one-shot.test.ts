import { afterEach, describe, expect, test } from "bun:test"

import { AGENT_INTERACTION_POLICIES } from "../agents"
import type { TaskRecord } from "../state"
import { cleanupSteering, makeFakeHandle, makeHarness, type SteeringHarness } from "./__fixtures__/steering-fakes"

afterEach(cleanupSteering)

function toRunning(harness: SteeringHarness, record: TaskRecord): void {
  harness.store.transition(record.task_id, { type: "start", timestamp: new Date().toISOString() })
}

function toCompleted(harness: SteeringHarness, record: TaskRecord): void {
  toRunning(harness, record)
  harness.store.transition(record.task_id, { type: "complete", timestamp: new Date().toISOString(), final_response: "first pass" })
}

describe("steering engine one-shot agent refusal", () => {
  test("#given a running resident momus child #when sent #then the outcome is one_shot_agent with the registry reminder and nothing is delivered", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ agent_type: "momus" })
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "steer attempt", deliverAs: "steer" })

    // then
    if (outcome.kind !== "one_shot_agent") throw new Error("expected one_shot_agent")
    expect(outcome.task_id).toBe(record.task_id)
    expect(outcome.agent).toBe("momus")
    expect(outcome.message).toBe(AGENT_INTERACTION_POLICIES.momus.sendDenialReminder)
    expect(fake.steerCalls).toEqual([])
    expect(fake.followUpCalls).toEqual([])
  })

  test("#given a pending momus child #when sent #then the outcome is one_shot_agent and nothing is queued", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ agent_type: "momus" })

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "pre-launch note" })

    // then
    if (outcome.kind !== "one_shot_agent") throw new Error("expected one_shot_agent")
    expect(outcome.message).toBe(AGENT_INTERACTION_POLICIES.momus.sendDenialReminder)
    expect(harness.store.load(record.task_id)?.pending_steering ?? []).toEqual([])
  })

  test("#given a completed resident momus child #when sent #then the outcome is one_shot_agent and no revive occurs", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ agent_type: "momus" })
    toCompleted(harness, record)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "revive attempt" })

    // then
    if (outcome.kind !== "one_shot_agent") throw new Error("expected one_shot_agent")
    expect(outcome.message).toBe(AGENT_INTERACTION_POLICIES.momus.sendDenialReminder)
    expect(fake.followUpCalls).toEqual([])
    expect(harness.reviveCalls).toEqual([])
    expect(harness.store.load(record.task_id)?.status).toBe("completed")
  })
})

describe("steering engine one-shot refusal vs scope ordering", () => {
  test("#given a foreign-owned momus child #when sent without all_scope #then the scope denial wins and the one-shot classification is not leaked", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ agent_type: "momus", parent_session_id: "parent-1", root_session_id: "parent-1" })
    toRunning(harness, record)
    harness.setLive(record.task_id, makeFakeHandle(record.task_id, "in-process").handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "hi", callerSessionId: "parent-2" })

    // then
    if (outcome.kind !== "scope_denied") throw new Error("expected scope_denied")
    expect(outcome.owning_session_id).toBe("parent-1")
  })

  test("#given a foreign-owned momus child #when sent with all_scope #then the one-shot refusal applies", async () => {
    // given
    const harness = makeHarness()
    const record = harness.seedRecord({ agent_type: "momus", parent_session_id: "parent-1", root_session_id: "parent-1" })
    toRunning(harness, record)
    const fake = makeFakeHandle(record.task_id, "in-process")
    harness.setLive(record.task_id, fake.handle)

    // when
    const outcome = await harness.engine.sendToTask({ idOrName: record.task_id, message: "hi", callerSessionId: "parent-2", allScope: true })

    // then
    if (outcome.kind !== "one_shot_agent") throw new Error("expected one_shot_agent")
    expect(outcome.message).toBe(AGENT_INTERACTION_POLICIES.momus.sendDenialReminder)
    expect(fake.steerCalls).toEqual([])
  })
})
