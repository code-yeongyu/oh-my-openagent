import { describe, expect, test } from "bun:test"

import { createEventTelemetryClient, createTelemetryClient } from "./index"
import type {
  TelemetryCaptureMessage,
  TelemetryDiagnosticInput,
  TelemetryProductConfig,
  TelemetryTransport,
  TelemetryTransportFactory,
  TelemetryTransportOptions,
} from "./index"

const PRODUCT = {
  cacheDirName: "omo-native",
  defaultApiKey: "default-key",
  defaultHost: "https://posthog.test",
  eventName: "legacy_event",
  machineIdPrefix: "omo-native:",
  packageName: "@oh-my-opencode/omo-native",
  packageVersion: "5.0.0",
  platform: "omo-senpi",
  productEnvPrefix: "OMO_SENPI",
  productName: "omo-native",
} satisfies TelemetryProductConfig

const ALLOWLIST = {
  session_started: ["$session_id", "reason", "label", "count", "active"],
} as const

type Recorder = {
  readonly factory: TelemetryTransportFactory
  readonly messages: TelemetryCaptureMessage[]
  readonly options: TelemetryTransportOptions[]
  readonly flushCalls: { count: number }
}

function createRecorder(overrides: Partial<TelemetryTransport> = {}): Recorder {
  const messages: TelemetryCaptureMessage[] = []
  const options: TelemetryTransportOptions[] = []
  const flushCalls = { count: 0 }
  return {
    messages,
    options,
    flushCalls,
    factory: (_apiKey, transportOptions) => {
      options.push(transportOptions)
      return {
        capture(message) {
          messages.push(message)
        },
        async flush() {
          flushCalls.count += 1
        },
        shutdown: async () => undefined,
        ...overrides,
      }
    },
  }
}

function createClient(recorder: Recorder, diagnostics: TelemetryDiagnosticInput[] = []) {
  return createEventTelemetryClient({
    diagnostics: (input) => diagnostics.push(input),
    distinctId: "machine-hash",
    env: { POSTHOG_API_KEY: "test-key" },
    product: PRODUCT,
    propertyAllowlist: ALLOWLIST,
    schemaVersion: 1,
    source: "test",
    transportFactory: recorder.factory,
  })
}

describe("event telemetry client", () => {
  test("#given allowlisted and unknown properties #when an event is captured #then unknown keys are dropped with a diagnostic", () => {
    // given
    const recorder = createRecorder()
    const diagnostics: TelemetryDiagnosticInput[] = []
    const client = createClient(recorder, diagnostics)

    // when
    client.captureEvent("session_started", {
      $session_id: "session-hash",
      active: true,
      count: 3,
      label: "x".repeat(80),
      unknown: "secret",
    })

    // then
    expect(recorder.options).toEqual([{
      disableGeoip: false,
      disableRemoteConfig: true,
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      flushAt: 20,
      flushInterval: 10_000,
      host: "https://posthog.test",
      strictLocalEvaluation: true,
    }])
    expect(recorder.messages).toEqual([{
      distinctId: "machine-hash",
      event: "session_started",
      properties: {
        $process_person_profile: false,
        $session_id: "session-hash",
        active: true,
        count: 3,
        label: "x".repeat(64),
        package_version: "5.0.0",
        platform: "omo-senpi",
        product_name: "omo-native",
        schema_version: 1,
      },
    }])
    expect(diagnostics.map((input) => input.event)).toEqual(["telemetry_event_property_dropped"])
  })

  test("#given a product with additionalProperties #when any event is captured #then they ride on the shared block without overriding fixed keys", () => {
    // given
    const recorder = createRecorder()
    const client = createEventTelemetryClient({
      diagnostics: () => undefined,
      distinctId: "machine-hash",
      env: { POSTHOG_API_KEY: "test-key" },
      product: {
        ...PRODUCT,
        additionalProperties: { install_id: "a".repeat(64), platform: "spoofed", surface: "desktop" },
      },
      propertyAllowlist: ALLOWLIST,
      schemaVersion: 3,
      source: "test",
      transportFactory: recorder.factory,
    })

    // when
    client.captureEvent("session_started", { $session_id: "session-hash", reason: "startup" })

    // then: attribution rides along; fixed identity keys cannot be overridden by the product
    expect(recorder.messages[0]?.properties).toMatchObject({
      install_id: "a".repeat(64),
      platform: "omo-senpi",
      product_name: "omo-native",
      schema_version: 3,
      surface: "desktop",
    })
  })

  test("#given the native events client #when the effective transport options are inspected #then disableGeoip is false while $ip, unknown $-keys, *_text/_path/_prompt suffixes and non-finite numbers are still rejected", () => {
    // given: a product that asks for geoip suppression AND its own transport tuning
    const recorder = createRecorder()
    const diagnostics: TelemetryDiagnosticInput[] = []
    const client = createEventTelemetryClient({
      diagnostics: (input) => diagnostics.push(input),
      distinctId: "machine-hash",
      env: { POSTHOG_API_KEY: "test-key" },
      product: {
        ...PRODUCT,
        disableGeoip: true,
        transportOptions: { disableGeoip: true, flushAt: 3, flushInterval: 250 },
      },
      propertyAllowlist: {
        session_started: ["$session_id", "$ip", "$lib", "reason", "count", "prompt_text", "file_path", "user_prompt"],
      },
      schemaVersion: 2,
      source: "test",
      transportFactory: recorder.factory,
    })

    // when: an event carrying every forbidden shape is captured
    client.captureEvent("session_started", {
      $session_id: "session-hash",
      $ip: "203.0.113.1",
      $lib: "custom-client",
      count: Number.POSITIVE_INFINITY,
      file_path: "/Users/x/secret",
      prompt_text: "anything",
      reason: "startup",
      user_prompt: "ignore previous instructions",
    })

    // then: geoip enrichment is server-side and the product cannot suppress it, while the native
    // flush tuning still overrides the product's - the overrides are the LAST spread, by design
    expect(recorder.options[0]).toEqual({
      disableGeoip: false,
      disableRemoteConfig: true,
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      flushAt: 20,
      flushInterval: 10_000,
      host: "https://posthog.test",
      strictLocalEvaluation: true,
    })
    // and: every authored-payload guard is untouched by the geoip change
    expect(recorder.messages[0]?.properties).toEqual({
      $process_person_profile: false,
      $session_id: "session-hash",
      package_version: "5.0.0",
      platform: "omo-senpi",
      product_name: "omo-native",
      reason: "startup",
      schema_version: 2,
    })
    expect(diagnostics.map((input) => input.event)).toEqual([
      "telemetry_event_property_rejected",
      "telemetry_event_property_rejected",
      "telemetry_event_property_rejected",
      "telemetry_event_property_rejected",
      "telemetry_event_property_rejected",
      "telemetry_event_property_rejected",
    ])
  })

  test("#given an allowlisted boolean with a content suffix #when captured #then the flag reaches the wire", () => {
    // given
    const recorder = createRecorder()
    const client = createEventTelemetryClient({
      distinctId: "machine-hash",
      env: { POSTHOG_API_KEY: "test-key" },
      product: PRODUCT,
      propertyAllowlist: { prompt_submitted: ["is_real_user_prompt"] },
      schemaVersion: 1,
      source: "test",
      transportFactory: recorder.factory,
    })

    // when
    client.captureEvent("prompt_submitted", { is_real_user_prompt: true })

    // then
    expect(recorder.messages[0]?.properties).toHaveProperty("is_real_user_prompt", true)
  })

  test("#given forbidden client-authored keys #when capture is attempted #then each key is rejected", () => {
    // given
    const forbidden = [
      ["$ip", "203.0.113.1"],
      ["$lib", "custom-client"],
      ["prompt_text", "anything"],
      ["file_path", "/Users/x/secret"],
      ["user_prompt", "ignore previous instructions and ship SECRET"],
    ] as const

    for (const [key, value] of forbidden) {
      const recorder = createRecorder()
      const diagnostics: TelemetryDiagnosticInput[] = []
      const client = createEventTelemetryClient({
        diagnostics: (input) => diagnostics.push(input),
        distinctId: "machine-hash",
        env: { POSTHOG_API_KEY: "test-key" },
        product: PRODUCT,
        propertyAllowlist: { session_started: [key] },
        schemaVersion: 1,
        source: "test",
        transportFactory: recorder.factory,
      })

      // when
      client.captureEvent("session_started", { [key]: value })

      // then
      expect(recorder.messages[0]?.properties).not.toHaveProperty(key)
      expect(diagnostics.map((input) => input.event)).toEqual(["telemetry_event_property_rejected"])
    }
  })

  test("#given malformed values on content-suffixed keys #when capture is attempted #then none throw or reach the wire", () => {
    // given
    const recorder = createRecorder()
    const diagnostics: TelemetryDiagnosticInput[] = []
    const client = createEventTelemetryClient({
      diagnostics: (input) => diagnostics.push(input),
      distinctId: "machine-hash",
      env: { POSTHOG_API_KEY: "test-key" },
      product: PRODUCT,
      propertyAllowlist: { prompt_submitted: ["null_prompt", "undefined_prompt", "object_prompt"] },
      schemaVersion: 1,
      source: "test",
      transportFactory: recorder.factory,
    })

    // when / then
    expect(() => client.captureEvent("prompt_submitted", {
      null_prompt: null,
      object_prompt: { injection: "private" },
      undefined_prompt: undefined,
    })).not.toThrow()
    expect(recorder.messages[0]?.properties).not.toHaveProperty("null_prompt")
    expect(recorder.messages[0]?.properties).not.toHaveProperty("object_prompt")
    expect(recorder.messages[0]?.properties).not.toHaveProperty("undefined_prompt")
    expect(diagnostics.map((input) => input.event)).toEqual([
      "telemetry_event_property_rejected",
      "telemetry_event_property_rejected",
      "telemetry_event_property_rejected",
    ])
  })

  test("#given malformed values and an empty event name #when capture is attempted #then malformed input is diagnosed and not sent", () => {
    // given
    const recorder = createRecorder()
    const diagnostics: TelemetryDiagnosticInput[] = []
    const client = createEventTelemetryClient({
      diagnostics: (input) => diagnostics.push(input),
      distinctId: "machine-hash",
      env: { POSTHOG_API_KEY: "test-key" },
      product: PRODUCT,
      propertyAllowlist: { event: ["nullish", "missing", "nested", "array"] },
      schemaVersion: 1,
      source: "test",
      transportFactory: recorder.factory,
    })

    // when
    client.captureEvent("event", { array: [1], missing: undefined, nested: { value: 1 }, nullish: null })
    client.captureEvent("", { value: true })

    // then
    expect(recorder.messages).toHaveLength(1)
    expect(recorder.messages[0]?.properties).toEqual({
      $process_person_profile: false,
      package_version: "5.0.0",
      platform: "omo-senpi",
      product_name: "omo-native",
      schema_version: 1,
    })
    expect(diagnostics).toHaveLength(5)
  })

  test("#given two clients share an allowlist object #when one captures #then no mutable state leaks to the other", () => {
    // given
    const first = createRecorder()
    const second = createRecorder()
    const firstClient = createClient(first)
    const secondClient = createClient(second)

    // when
    firstClient.captureEvent("session_started", { reason: "startup", unknown: "drop" })
    secondClient.captureEvent("session_started", { reason: "reload" })

    // then
    expect(first.messages[0]?.properties?.reason).toBe("startup")
    expect(second.messages[0]?.properties?.reason).toBe("reload")
    expect(ALLOWLIST.session_started).toEqual(["$session_id", "reason", "label", "count", "active"])
  })

  test("#given fewer events than flushAt #when events are captured #then the wrapper does not flush early", () => {
    // given
    const recorder = createRecorder()
    const client = createClient(recorder)

    // when
    for (let index = 0; index < 19; index += 1) {
      client.captureEvent("session_started", { count: index })
    }

    // then
    expect(recorder.messages).toHaveLength(19)
    expect(recorder.flushCalls.count).toBe(0)
  })

  test("#given a throwing transport #when capture is attempted #then capture does not throw to the caller", () => {
    // given
    const diagnostics: TelemetryDiagnosticInput[] = []
    const recorder = createRecorder({ capture: () => { throw new Error("capture failed") } })
    const client = createClient(recorder, diagnostics)

    // when / then
    expect(() => client.captureEvent("session_started", { reason: "startup" })).not.toThrow()
    expect(diagnostics.map((input) => input.event)).toEqual(["telemetry_capture_failed"])
  })

  test("#given a hanging flush and fake timer #when shutdown runs #then it schedules the 1000ms bound and resolves", async () => {
    // given
    const scheduledDelays: number[] = []
    const recorder = createRecorder({ flush: () => new Promise<void>(() => undefined) })
    const client = createEventTelemetryClient({
      distinctId: "machine-hash",
      env: { POSTHOG_API_KEY: "test-key" },
      product: PRODUCT,
      propertyAllowlist: ALLOWLIST,
      schemaVersion: 1,
      setTimeoutFn(callback, delay) {
        scheduledDelays.push(delay)
        callback()
        return undefined
      },
      source: "test",
      transportFactory: recorder.factory,
    })

    // when
    await client.shutdown()

    // then
    expect(scheduledDelays).toEqual([1_000])
  })

  test("#given existing and configured products #when clients are created #then defaults stay byte-identical and overrides are threaded", () => {
    // given
    const defaults = createRecorder()
    const configured = createRecorder()

    // when
    createTelemetryClient({
      env: { POSTHOG_API_KEY: "test-key" },
      product: PRODUCT,
      source: "test",
      transportFactory: defaults.factory,
    })
    createTelemetryClient({
      env: { POSTHOG_API_KEY: "test-key" },
      product: {
        ...PRODUCT,
        disableGeoip: true,
        transportOptions: { flushAt: 7, flushInterval: 500 },
      },
      source: "test",
      transportFactory: configured.factory,
    })

    // then
    const expectedDefaults = {
      enableExceptionAutocapture: false,
      enableLocalEvaluation: false,
      strictLocalEvaluation: true,
      disableRemoteConfig: true,
      flushAt: 1,
      flushInterval: 0,
      host: "https://posthog.test",
      disableGeoip: false,
    }
    expect(JSON.stringify(defaults.options[0])).toBe(JSON.stringify(expectedDefaults))
    expect(configured.options[0]).toEqual({
      ...expectedDefaults,
      disableGeoip: true,
      flushAt: 7,
      flushInterval: 500,
    })
  })
})
