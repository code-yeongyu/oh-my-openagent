import { describe, expect, test } from "bun:test"

import type { ReflectionRequest } from "./machine"
import {
  REFLECTION_PARK_NON_RETRYABLE_STREAK,
  REFLECTION_PARK_PROBE_INTERVAL_MS,
  REFLECTION_PARK_RETRYABLE_STREAK,
  applyReflectionParkFailure,
  clearReflectionPark,
  emptyReflectionParkState,
  gateReflectionRequest,
  isAutomaticReflectionRequest,
  isReflectionParked,
  markReflectionProbe,
  parseReflectionParkState,
  type ReflectionParkState,
} from "./park"

const T0 = Date.parse("2026-09-15T06:00:00.000Z")
const at = (offsetMs: number) => new Date(T0 + offsetMs).toISOString()

const stepCount: ReflectionRequest = { trigger: "step-count", conversationIds: ["c"], snapshots: [] }
const compaction: ReflectionRequest = { trigger: "compaction", conversationIds: ["c"], snapshots: [] }
const manual: ReflectionRequest = { trigger: "manual", conversationIds: ["c"], snapshots: [] }
const dreamIdle: ReflectionRequest = { trigger: "dream", origin: "idle", conversationIds: ["c"], snapshots: [] }
const dreamManual: ReflectionRequest = { trigger: "dream", origin: "manual", conversationIds: ["c"], snapshots: [] }

function failNTimes(
  count: number,
  retryable: boolean,
  fingerprint = retryable ? "child_exit:OpenAI API error (429)" : "spawn_failed:Model not found",
): ReflectionParkState {
  let state = emptyReflectionParkState()
  for (let index = 0; index < count; index += 1) {
    state = applyReflectionParkFailure(state, {
      runId: `run-${index + 1}`,
      at: at(index * 60_000),
      fingerprint,
      retryable,
      reason: fingerprint.split(":")[0],
      detail: fingerprint.split(":")[1],
    })
  }
  return state
}

describe("reflection park policy", () => {
  test("#given fewer non-retryable failures than the threshold #when applied #then the streak counts and nothing is parked", () => {
    // when
    const state = failNTimes(REFLECTION_PARK_NON_RETRYABLE_STREAK - 1, false)

    // then
    expect(state.streak).toBe(REFLECTION_PARK_NON_RETRYABLE_STREAK - 1)
    expect(isReflectionParked(state)).toBe(false)
    expect(state.firstFailureAt).toBe(at(0))
    expect(state.lastFailure?.runId).toBe(`run-${REFLECTION_PARK_NON_RETRYABLE_STREAK - 1}`)
  })

  test("#given the non-retryable threshold is reached #when applied #then the identity parks at that failure's time", () => {
    // when
    const state = failNTimes(REFLECTION_PARK_NON_RETRYABLE_STREAK, false)

    // then
    expect(isReflectionParked(state)).toBe(true)
    expect(state.parkedAt).toBe(at((REFLECTION_PARK_NON_RETRYABLE_STREAK - 1) * 60_000))
  })

  test("#given retryable failures below their higher threshold #when applied #then nothing is parked", () => {
    // when
    const state = failNTimes(REFLECTION_PARK_RETRYABLE_STREAK - 1, true)

    // then
    expect(isReflectionParked(state)).toBe(false)
  })

  test("#given the retryable threshold is reached #when applied #then the identity parks", () => {
    // when
    const state = failNTimes(REFLECTION_PARK_RETRYABLE_STREAK, true)

    // then
    expect(isReflectionParked(state)).toBe(true)
  })

  test("#given a parked identity #when another failure lands #then it stays parked at the original time and the streak grows", () => {
    // given
    const parked = failNTimes(REFLECTION_PARK_NON_RETRYABLE_STREAK, false)

    // when
    const state = applyReflectionParkFailure(parked, {
      runId: "run-probe", at: at(7 * 60 * 60_000), fingerprint: "x:y", retryable: false,
    })

    // then
    expect(state.parkedAt).toBe(parked.parkedAt)
    expect(state.streak).toBe(REFLECTION_PARK_NON_RETRYABLE_STREAK + 1)
    expect(state.lastFailure?.runId).toBe("run-probe")
  })

  test("#given a detail longer than the cap #when applied #then the stored detail is bounded", () => {
    // when
    const state = applyReflectionParkFailure(emptyReflectionParkState(), {
      runId: "run-1", at: at(0), fingerprint: "f", retryable: true, detail: "x".repeat(10_000),
    })

    // then
    expect(state.lastFailure?.detail?.length).toBeLessThanOrEqual(512)
  })

  test("#given any park state #when cleared #then it is empty again", () => {
    // when
    const state = clearReflectionPark()

    // then
    expect(state).toEqual(emptyReflectionParkState())
  })
})

describe("reflection park gate", () => {
  test("#given no park #when any request arrives #then the gate is open", () => {
    expect(gateReflectionRequest(emptyReflectionParkState(), stepCount, at(0))).toEqual({ kind: "open" })
    expect(gateReflectionRequest(emptyReflectionParkState(), dreamIdle, at(0))).toEqual({ kind: "open" })
  })

  test("#given a parked identity #when an automatic request arrives inside the probe interval #then it is parked with the next probe time", () => {
    // given
    const parked = failNTimes(REFLECTION_PARK_NON_RETRYABLE_STREAK, false)
    const parkedAt = Date.parse(parked.parkedAt ?? "")

    // when
    const gate = gateReflectionRequest(parked, stepCount, new Date(parkedAt + 60_000).toISOString())

    // then
    expect(gate).toEqual({ kind: "parked", nextProbeAt: new Date(parkedAt + REFLECTION_PARK_PROBE_INTERVAL_MS).toISOString() })
    expect(gateReflectionRequest(parked, compaction, new Date(parkedAt + 60_000).toISOString()).kind).toBe("parked")
    expect(gateReflectionRequest(parked, dreamIdle, new Date(parkedAt + 60_000).toISOString()).kind).toBe("parked")
  })

  test("#given a parked identity #when a manual request arrives #then the gate is open", () => {
    // given
    const parked = failNTimes(REFLECTION_PARK_NON_RETRYABLE_STREAK, false)

    // then
    expect(gateReflectionRequest(parked, manual, at(0))).toEqual({ kind: "open" })
    expect(gateReflectionRequest(parked, dreamManual, at(0))).toEqual({ kind: "open" })
  })

  test("#given a parked identity past the probe interval #when an automatic request arrives #then exactly one probe is admitted and the next one waits", () => {
    // given
    const parked = failNTimes(REFLECTION_PARK_NON_RETRYABLE_STREAK, false)
    const parkedAt = Date.parse(parked.parkedAt ?? "")
    const due = new Date(parkedAt + REFLECTION_PARK_PROBE_INTERVAL_MS).toISOString()

    // when
    const first = gateReflectionRequest(parked, stepCount, due)
    const probed = markReflectionProbe(parked, due)
    const second = gateReflectionRequest(probed, stepCount, new Date(Date.parse(due) + 1_000).toISOString())

    // then
    expect(first).toEqual({ kind: "probe" })
    expect(isReflectionParked(probed)).toBe(true)
    expect(second).toEqual({ kind: "parked", nextProbeAt: new Date(Date.parse(due) + REFLECTION_PARK_PROBE_INTERVAL_MS).toISOString() })
  })

  test("#given request kinds #when classified #then only manual reflections and manual dreams are not automatic", () => {
    expect(isAutomaticReflectionRequest(stepCount)).toBe(true)
    expect(isAutomaticReflectionRequest(compaction)).toBe(true)
    expect(isAutomaticReflectionRequest(dreamIdle)).toBe(true)
    expect(isAutomaticReflectionRequest(manual)).toBe(false)
    expect(isAutomaticReflectionRequest(dreamManual)).toBe(false)
  })
})

describe("reflection park thresholds", () => {
  test("#given the shipped policy #when the constants are read #then they match the 3 / 6 / 6 h contract", () => {
    expect(REFLECTION_PARK_NON_RETRYABLE_STREAK).toBe(3)
    expect(REFLECTION_PARK_RETRYABLE_STREAK).toBe(6)
    expect(REFLECTION_PARK_PROBE_INTERVAL_MS).toBe(6 * 60 * 60_000)
  })
})

describe("reflection park state parsing", () => {
  test("#given a well-formed persisted state #when parsed #then it round-trips", () => {
    // given
    const state = markReflectionProbe(failNTimes(REFLECTION_PARK_NON_RETRYABLE_STREAK, false), at(7 * 60 * 60_000))

    // then
    expect(parseReflectionParkState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  test.each([
    ["not an object", 42],
    ["wrong version", { version: 2, streak: 0 }],
    ["negative streak", { version: 1, streak: -1 }],
    ["parked without a timestamp string", { version: 1, streak: 3, parkedAt: 12345 }],
  ])("#given %s #when parsed #then it is rejected", (_label, value) => {
    expect(() => parseReflectionParkState(value)).toThrow()
  })
})
