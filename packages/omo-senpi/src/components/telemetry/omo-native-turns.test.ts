import { describe, expect, test } from "bun:test"
import type { TurnEndEvent } from "@code-yeongyu/senpi"
import type {
  EventTelemetryClient,
  EventTelemetryProperties,
  TelemetryDiagnosticInput,
} from "@oh-my-opencode/telemetry-core"
import {
  KNOWN_MODELS,
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  type KnownProvider,
} from "./product-identity"
import { createOmoNativeTurnHandler, maskModel } from "./omo-native-turns"
import { createSessionSummaryRecorder } from "./omo-native-session-summary"

type CapturedEvent = { readonly name: string; readonly properties: EventTelemetryProperties }

function createRecorder(): {
  readonly captured: CapturedEvent[]
  readonly diagnostics: TelemetryDiagnosticInput[]
  readonly handle: (event: TurnEndEvent) => void
} {
  const captured: CapturedEvent[] = []
  const diagnostics: TelemetryDiagnosticInput[] = []
  const client: Pick<EventTelemetryClient, "captureEvent"> = {
    captureEvent(name, properties) {
      captured.push({ name, properties })
    },
  }
  return {
    captured,
    diagnostics,
    handle: createOmoNativeTurnHandler({
      client,
      diagnostics: (input) => diagnostics.push(input),
      isConsented: () => true,
      sessionId: "hashed-session",
      summary: createSessionSummaryRecorder({
        captureEvent: () => undefined,
        sampleRate: 1,
        store: { read: () => undefined, write: () => undefined, remove: () => undefined, claimOrphans: () => [] },
      }),
    }),
  }
}

test("#given a known model routed through an unknown provider #when the summary records it #then the model stays named and only the provider is custom", () => {
  const rows: EventTelemetryProperties[] = []
  const summary = createSessionSummaryRecorder({
    captureEvent: (_name, properties) => rows.push(properties),
    sampleRate: 0,
    store: { read: () => undefined, write: () => undefined, remove: () => undefined, claimOrphans: () => [] },
  })
  const handle = createOmoNativeTurnHandler({ client: { captureEvent: () => undefined }, isConsented: () => true, sessionId: "s", summary })

  handle(turnEvent({ provider: "my-private-gateway", model: "gpt-5.6-sol" }))
  summary.finish("s", "quit")

  expect(rows[0]).toMatchObject({ m1_provider: "custom", m1_model: "gpt-5.6-sol", custom_model_turns: 0 })
})

// Sampling is decided per session, long before a turn is sent. Consent must be read again at send time:
// a session that was sampled while opted in and is then opted out must not send a raw turn.
test("#given a sampled session whose consent is withdrawn between sampling and send #when the turn ends #then no turn_completed is sent", () => {
  // given
  const sent: string[] = []
  let consent = true
  const summary = createSessionSummaryRecorder({
    captureEvent: () => undefined,
    sampleRate: 1,
    store: { read: () => undefined, write: () => undefined, remove: () => undefined, claimOrphans: () => [] },
  })
  const handle = createOmoNativeTurnHandler({
    client: { captureEvent: (name) => sent.push(name) },
    isConsented: () => consent,
    sessionId: "sampled",
    summary: {
      ...summary,
      isRawTurnSampled: (sessionHash) => {
        const sampled = summary.isRawTurnSampled(sessionHash)
        consent = false
        return sampled
      },
    },
  })

  // when
  handle(turnEvent())

  // then
  expect(consent).toBe(false)
  expect(sent).toEqual([])
})

function turnEvent(input: {
  readonly turnIndex?: number
  readonly message?: unknown
  readonly provider?: string
  readonly model?: string
  readonly usage?: unknown
} = {}): TurnEndEvent {
  const usage = input.usage ?? {
    input: 11,
    output: 22,
    cacheRead: 3,
    cacheWrite: 4,
    reasoning: 5,
    totalTokens: 40,
    cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.123456 },
  }
  const message = input.message ?? {
    role: "assistant",
    content: [],
    api: "openai-responses",
    provider: input.provider ?? "openai",
    model: input.model ?? "gpt-5.6-sol",
    usage,
    stopReason: "stop",
    timestamp: 1,
  }
  return { type: "turn_end", turnIndex: input.turnIndex ?? 7, message, toolResults: [] } as unknown as TurnEndEvent
}

function firstKnownModel(provider: KnownProvider): string {
  const model = KNOWN_MODELS[provider][0]
  expect(model).toBeDefined()
  return model ?? ""
}

describe("OmO Native turn telemetry", () => {
  test("#given provider and model identities #when masked #then each field is decided independently", () => {
    const knownModel = firstKnownModel("openai")

    expect(maskModel("openai", knownModel)).toEqual({ provider: "openai", model_id: knownModel })
    expect(maskModel("openai", "user-defined-model")).toEqual({ provider: "openai", model_id: "custom" })
    expect(maskModel("sionic-openrouter", knownModel)).toEqual({ provider: "custom", model_id: "custom" })
    expect(maskModel("sionic-openrouter", "user-defined-model")).toEqual({ provider: "custom", model_id: "custom" })
  })

  test("#given an assistant turn #when it ends #then exactly one allowlisted turn_completed payload is emitted", () => {
    const recorder = createRecorder()

    recorder.handle(turnEvent())

    expect(recorder.captured).toHaveLength(1)
    expect(recorder.captured[0]).toEqual({
      name: "turn_completed",
      properties: {
        $session_id: "hashed-session",
        provider: "openai",
        model_id: "gpt-5.6-sol",
        input_tokens: 11,
        output_tokens: 22,
        cache_read_tokens: 3,
        cache_write_tokens: 4,
        reasoning_tokens: 5,
        total_tokens: 40,
        cost_usd: 0.1235,
        turn_index: 7,
        sample_rate: 1,
      },
    })
    expect(Object.keys(recorder.captured[0]?.properties ?? {}).sort()).toEqual(
      [...OMO_NATIVE_PROPERTY_ALLOWLISTS.turn_completed].sort(),
    )
  })

  test("#given reasoning is absent #when the assistant turn ends #then reasoning is zero and not added to total", () => {
    const recorder = createRecorder()
    const usage = {
      input: 2,
      output: 9,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 11,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    }

    recorder.handle(turnEvent({ usage }))

    expect(recorder.captured[0]?.properties.reasoning_tokens).toBe(0)
    expect(recorder.captured[0]?.properties.output_tokens).toBe(9)
    expect(recorder.captured[0]?.properties.total_tokens).toBe(11)
    expect(recorder.diagnostics).toHaveLength(0)
  })

  test("#given a non-assistant AgentMessage #when turn_end fires #then no event is emitted", () => {
    const recorder = createRecorder()

    recorder.handle(turnEvent({ message: { role: "user", content: "hello", timestamp: 1 } }))

    expect(recorder.captured).toHaveLength(0)
    expect(recorder.diagnostics).toHaveLength(0)
  })

  test("#given missing usage #when the assistant turn ends #then zero values and one diagnostic are emitted", () => {
    const recorder = createRecorder()
    const message = {
      role: "assistant",
      provider: "openai",
      model: "gpt-5.6-sol",
    }

    expect(() => recorder.handle(turnEvent({ message }))).not.toThrow()

    expect(recorder.captured).toHaveLength(1)
    expect(recorder.captured[0]?.properties).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 0,
      cost_usd: 0,
    })
    expect(recorder.diagnostics).toHaveLength(1)
  })

  test("#given malformed usage #when the assistant turn ends #then invalid values become zero with one diagnostic", () => {
    const recorder = createRecorder()

    recorder.handle(turnEvent({
      usage: {
        input: Number.NaN,
        output: -2,
        cacheRead: 3,
        cacheWrite: Number.POSITIVE_INFINITY,
        reasoning: -1,
        totalTokens: 4,
        cost: null,
      },
    }))

    expect(recorder.captured[0]?.properties).toMatchObject({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 3,
      cache_write_tokens: 0,
      reasoning_tokens: 0,
      total_tokens: 4,
      cost_usd: 0,
    })
    expect(recorder.diagnostics).toHaveLength(1)
  })

  test("#given successive assistant turns #when emitted #then turn_index follows the host monotonically", () => {
    const recorder = createRecorder()

    recorder.handle(turnEvent({ turnIndex: 8 }))
    recorder.handle(turnEvent({ turnIndex: 9 }))

    expect(recorder.captured.map(({ properties }) => properties.turn_index)).toEqual([8, 9])
    expect(recorder.captured).toHaveLength(2)
  })
})
