/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { EventTelemetryProperties } from "@oh-my-opencode/telemetry-core"
import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createKibitzerTelemetryObservers, type KibitzerTelemetrySignal } from "../memory/kibitzer/wake-observers"
import {
  buildKibitzerSummary,
  createKibitzerTelemetryRegistry,
  registerOmoNativeKibitzerSummary,
  type KibitzerTelemetryRegistry,
} from "./omo-native-kibitzer-summary"
import { ALL_KNOWN_MODEL_IDS, OMO_NATIVE_PROPERTY_ALLOWLISTS } from "./product-identity"

const SESSION = "session-kibitzer-1"
const OTHER = "session-kibitzer-2"
const KNOWN_MODEL = [...ALL_KNOWN_MODEL_IDS][0] ?? "gpt-5.6-sol"

type WakeOverrides = Partial<Extract<KibitzerTelemetrySignal, { kind: "wake" }>>

function wake(overrides: WakeOverrides = {}): KibitzerTelemetrySignal {
  return {
    kind: "wake",
    sessionId: SESSION,
    wake: 1,
    generation: 1,
    status: "completed",
    nudges: 0,
    candidateCount: 2,
    toolCalls: 1,
    durationMs: 5_000,
    slotWaitMs: 100,
    model: `anthropic/${KNOWN_MODEL}`,
    usage: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40 },
    ...overrides,
  }
}

function offer(action: "seeded" | "steered" | "buffered", reason?: "cooldown" | "no_new_candidate"): KibitzerTelemetrySignal {
  return { kind: "offer", sessionId: SESSION, action, ...(reason === undefined ? {} : { reason }) }
}

/** Four wakes: nudges at t=1s, t=601s and t=901s, one failure between them. */
function populated(registry: KibitzerTelemetryRegistry): void {
  registry.record(offer("seeded"), 900)
  registry.record(wake({ wake: 1, nudges: 1 }), 1_000)
  registry.record(offer("buffered", "cooldown"), 300_900)
  registry.record(wake({ wake: 2, status: "failed", nudges: 0, toolCalls: 0, durationMs: 9_000 }), 301_000)
  registry.record(offer("buffered", "no_new_candidate"), 600_900)
  registry.record(wake({ wake: 3, generation: 2, nudges: 1, model: "acme-private/internal-codename" }), 601_000)
  registry.record(offer("steered"), 900_900)
  registry.record(wake({ wake: 4, generation: 2, nudges: 2, status: "deadline", slotWaitMs: 400 }), 901_000)
}

describe("kibitzer summary snapshot", () => {
  test("#given wakes and buffered offers #when the session is summarized #then nudge counts, cadence, cost and outcome mix are reported", () => {
    const registry = createKibitzerTelemetryRegistry()
    populated(registry)

    const snapshot = registry.snapshot(SESSION)
    if (snapshot === undefined) throw new Error("snapshot missing")
    const properties = buildKibitzerSummary(snapshot, "hashed")
    if (properties === undefined) throw new Error("summary missing")

    expect(properties["$session_id"]).toBe("hashed")
    expect(properties["nudges_delivered"]).toBe(4)
    expect(properties["wakes_total"]).toBe(4)
    expect(properties["wakes_with_nudge"]).toBe(3)
    expect(properties["wakes_failed"]).toBe(1)
    expect(properties["wakes_deadline"]).toBe(1)
    expect(properties["wakes_tool_budget"]).toBe(0)
    expect(properties["first_nudge_wake"]).toBe(1)
    expect(properties["nudge_gap_ms_median"]).toBe(300_000)
    expect(properties["nudge_gap_ms_p90"]).toBe(600_000)
    expect(properties["wake_span_ms"]).toBe(900_000)
    expect(properties["offers_total"]).toBe(4)
    expect(properties["buffered_cooldown"]).toBe(1)
    expect(properties["buffered_no_new_candidate"]).toBe(1)
    expect(properties["wake_duration_ms_total"]).toBe(24_000)
    expect(properties["slot_wait_ms_total"]).toBe(700)
    expect(properties["tool_calls_total"]).toBe(3)
    expect(properties["candidates_total"]).toBe(8)
    expect(properties["input_tokens"]).toBe(40)
    expect(properties["output_tokens"]).toBe(80)
    expect(properties["cache_read_tokens"]).toBe(120)
    expect(properties["cache_write_tokens"]).toBe(160)
    expect(properties["generations"]).toBe(2)
  })

  test("#given a private model id on the dominant rung #when the summary is built #then the model is masked to custom and never exported verbatim", () => {
    const registry = createKibitzerTelemetryRegistry()
    registry.record(wake({ model: "acme-private/internal-codename" }), 1_000)
    registry.record(wake({ wake: 2, model: "acme-private/internal-codename" }), 2_000)
    registry.record(wake({ wake: 3, model: `anthropic/${KNOWN_MODEL}` }), 3_000)

    const snapshot = registry.snapshot(SESSION)
    if (snapshot === undefined) throw new Error("snapshot missing")
    const properties = buildKibitzerSummary(snapshot, "hashed")
    expect(properties?.["model_top"]).toBe("custom")
    expect(JSON.stringify(properties)).not.toContain("internal-codename")
  })

  test("#given a known model id #when it is the dominant rung #then it survives masking", () => {
    const registry = createKibitzerTelemetryRegistry()
    registry.record(wake({ model: `anthropic/${KNOWN_MODEL}` }), 1_000)

    const snapshot = registry.snapshot(SESSION)
    if (snapshot === undefined) throw new Error("snapshot missing")
    expect(buildKibitzerSummary(snapshot, "hashed")?.["model_top"]).toBe(KNOWN_MODEL)
  })

  test("#given a session that only buffered offers #when it is summarized #then the event still reports the blocked cadence", () => {
    const registry = createKibitzerTelemetryRegistry()
    registry.record(offer("buffered", "cooldown"), 1_000)

    const snapshot = registry.snapshot(SESSION)
    if (snapshot === undefined) throw new Error("snapshot missing")
    const properties = buildKibitzerSummary(snapshot, "hashed")
    expect(properties?.["wakes_total"]).toBe(0)
    expect(properties?.["buffered_cooldown"]).toBe(1)
    expect(properties?.["model_top"]).toBe("none")
    expect(properties?.["nudge_gap_ms_median"]).toBe(0)
    expect(properties?.["first_nudge_wake"]).toBe(0)
  })

  test("#given a session the sidecar never touched #when shutdown asks for a snapshot #then nothing is recorded and no event is built", () => {
    const registry = createKibitzerTelemetryRegistry()
    expect(registry.snapshot(SESSION)).toBeUndefined()
    expect(registry.size()).toBe(0)
  })

  test("#given every summary property #when it is checked against the schema #then each one is declared in the kibitzer_summary allowlist", () => {
    const registry = createKibitzerTelemetryRegistry()
    populated(registry)
    const snapshot = registry.snapshot(SESSION)
    if (snapshot === undefined) throw new Error("snapshot missing")
    const properties = buildKibitzerSummary(snapshot, "hashed")
    if (properties === undefined) throw new Error("summary missing")

    const allowlist = OMO_NATIVE_PROPERTY_ALLOWLISTS["kibitzer_summary"]
    expect(allowlist).toBeDefined()
    expect(Object.keys(properties).sort()).toEqual([...allowlist].sort())
    for (const key of Object.keys(properties)) expect(key).not.toMatch(/_(?:text|path|prompt)$/)
  })
})

describe("registerOmoNativeKibitzerSummary", () => {
  function fixture(): {
    readonly captured: Array<{ name: string; properties: EventTelemetryProperties }>
    readonly observers: ReturnType<typeof createKibitzerTelemetryObservers>
    readonly pi: FakeExtensionAPI
    readonly detach: () => void
  } {
    const captured: Array<{ name: string; properties: EventTelemetryProperties }> = []
    const observers = createKibitzerTelemetryObservers()
    const pi = new FakeExtensionAPI()
    let clock = 1_000
    const detach = registerOmoNativeKibitzerSummary(pi, {
      captureEvent: (name, properties) => captured.push({ name, properties }),
      hashSessionId: (raw) => `hash:${raw}`,
      now: () => {
        clock += 1_000
        return clock
      },
      subscribe: observers.subscribe,
    })
    return { captured, observers, pi, detach }
  }

  function context(sessionId: string): Record<string, unknown> {
    return { sessionManager: { getSessionId: () => sessionId } }
  }

  test("#given a settled wake on the observer seam #when the session shuts down #then exactly one event is captured and a second shutdown emits nothing", async () => {
    const f = fixture()
    f.observers.notify(wake({ nudges: 2 }))

    await f.pi.dispatch("session_shutdown", {}, context(SESSION))
    await f.pi.dispatch("session_shutdown", {}, context(SESSION))

    expect(f.captured.map((event) => event.name)).toEqual(["kibitzer_summary"])
    expect(f.captured[0]?.properties["$session_id"]).toBe(`hash:${SESSION}`)
    expect(f.captured[0]?.properties["nudges_delivered"]).toBe(2)
    f.detach()
  })

  test("#given two sessions on one process #when each shuts down #then their counts never mix", async () => {
    const f = fixture()
    f.observers.notify(wake({ nudges: 1 }))
    f.observers.notify(wake({ sessionId: OTHER, nudges: 5 }))

    await f.pi.dispatch("session_shutdown", {}, context(SESSION))
    await f.pi.dispatch("session_shutdown", {}, context(OTHER))

    expect(f.captured.map((event) => event.properties["nudges_delivered"])).toEqual([1, 5])
    f.detach()
  })

  test("#given a session with no sidecar activity #when it shuts down #then no event is spent", async () => {
    const f = fixture()
    await f.pi.dispatch("session_shutdown", {}, context(SESSION))
    expect(f.captured).toEqual([])
    f.detach()
  })

  test("#given the registration is detached #when a later wake arrives #then nothing is recorded", async () => {
    const f = fixture()
    f.detach()
    f.observers.notify(wake({ nudges: 3 }))

    await f.pi.dispatch("session_shutdown", {}, context(SESSION))
    expect(f.captured).toEqual([])
  })
})
