import { afterEach, describe, expect, test } from "bun:test"
import type { TurnEndEvent } from "@code-yeongyu/senpi"
import type {
  EventTelemetryClient,
  EventTelemetryProperties,
  TelemetryDiagnosticInput,
} from "@oh-my-opencode/telemetry-core"
import {
  KNOWN_MODELS,
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
} from "./product-identity"
import { createOmoNativeTurnHandler } from "./omo-native-turns"
import { createTempStateDirs, createTestRecorder } from "./session-summary.test-support"

type CapturedEvent = { readonly name: string; readonly properties: EventTelemetryProperties }

const stateDirs = createTempStateDirs()
afterEach(() => stateDirs.cleanup())

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
      sessionRole: "root",
      summary: createTestRecorder({ dir: stateDirs.make(), sampleRate: 1 }).summary,
    }),
  }
}

test("#given a known model routed through an unknown provider #when the summary records it #then the model stays named and only the provider is custom", async () => {
  const recorder = createTestRecorder({ dir: stateDirs.make(), sampleRate: 0 })
  const handle = createOmoNativeTurnHandler({ client: { captureEvent: () => undefined }, isConsented: () => true, sessionId: "s", sessionRole: "root", summary: recorder.summary })

  handle(turnEvent({ provider: "my-private-gateway", model: "gpt-5.6-sol" }))
  await recorder.summary.finish("s", "quit")

  expect(recorder.published[0]?.properties).toMatchObject({ m1_provider: "custom", m1_model: "gpt-5.6-sol", custom_model_turns: 0 })
})

// Cost contract (plan todo 8): cost_1e4 = round(cost * 1e4) is the only rounding step, cost_usd is derived
// from it, and the summary adds integers, so raw rows and the summary agree exactly in any order.
describe("integer cost accounting", () => {
  async function costsOf(costs: readonly number[]): Promise<{ turns: unknown[][]; summary: EventTelemetryProperties | undefined; summaryTotal: number }> {
    const captured: CapturedEvent[] = []
    const recorder = createTestRecorder({ dir: stateDirs.make(), sampleRate: 1 })
    const handle = createOmoNativeTurnHandler({
      client: { captureEvent: (name, properties) => captured.push({ name, properties }) },
      isConsented: () => true,
      sessionId: "s",
      sessionRole: "root",
      summary: recorder.summary,
    })
    costs.forEach((total, index) => handle(turnEvent({ turnIndex: index, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total } } })))
    await recorder.summary.finish("s", "quit")
    return {
      turns: captured.map(({ properties }) => [properties.cost_1e4, properties.cost_usd]),
      summary: recorder.published.at(-1)?.properties,
      summaryTotal: recorder.published.reduce((sum, { properties }) => sum + Number(properties.cost_1e4), 0),
    }
  }

  test.each([
    [[0.00006, 0.00006], [[1, 0.0001], [1, 0.0001]], 2, 0.0002],
    [[0.1, 0.2], [[1000, 0.1], [2000, 0.2]], 3000, 0.3],
    [[0.00005], [[1, 0.0001]], 1, 0.0001],
    [[0.00015], [[2, 0.0002]], 2, 0.0002],
    [[0.000049], [[0, 0]], 0, 0],
  ])("#given turn costs %p #when summed #then turns report %p and the summary %p / %p", async (costs, turns, summary1e4, summaryUsd) => {
    const result = await costsOf(costs)
    expect(result.turns).toEqual(turns)
    expect(result.summary).toMatchObject({ cost_1e4: summary1e4, cost_usd: summaryUsd })
  })

  test("#given 1,000 turns #when they arrive in two different orders #then the summary rows add up to the same integer as the raw turns", async () => {
    const costs = Array.from({ length: 1_000 }, (_, index) => ((index * 7_919) % 1_000) / 100_003)
    const forward = await costsOf(costs)
    const backward = await costsOf([...costs].reverse())
    const sumOfTurns = forward.turns.reduce((sum, [cost1e4]) => sum + Number(cost1e4), 0)
    expect(forward.summaryTotal).toBe(sumOfTurns)
    expect(backward.summaryTotal).toBe(sumOfTurns)
  })
})

// Sampling is decided per session, long before a turn is sent. Consent must be read again at send time:
// a session that was sampled while opted in and is then opted out must not send a raw turn.
test("#given a sampled session whose consent is withdrawn between sampling and send #when the turn ends #then no turn_completed is sent", () => {
  // given
  const sent: string[] = []
  let consent = true
  const { summary } = createTestRecorder({ dir: stateDirs.make(), sampleRate: 1 })
  const handle = createOmoNativeTurnHandler({
    client: { captureEvent: (name) => sent.push(name) },
    isConsented: () => consent,
    sessionId: "sampled",
    sessionRole: "root",
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

const OPENAI_MODEL = KNOWN_MODELS.openai[0] ?? "gpt-5.6-sol"

describe("OmO Native turn telemetry", () => {
  // Privacy contract (docs/reference/senpi-telemetry.md masking table): the raw turn row masks provider
  // and model independently, exactly like session_summary, so a public model behind a private gateway
  // stays named while the gateway name never leaves the machine.
  test.each([
    ["openai", OPENAI_MODEL, "openai", OPENAI_MODEL],
    ["openai", "user-defined-model", "openai", "custom"],
    ["my-proxy", "claude-opus-5-5", "custom", "claude-opus-5-5"],
    ["my-proxy", "user-defined-model", "custom", "custom"],
  ])("#given provider %s and model %s #when turn_completed is emitted #then it reports %s / %s", (provider, model, maskedProvider, maskedModel) => {
    const recorder = createRecorder()

    recorder.handle(turnEvent({ provider, model }))

    expect(recorder.captured[0]?.properties).toMatchObject({ provider: maskedProvider, model_id: maskedModel })
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
        cost_1e4: 1235,
        cost_usd: 0.1235,
        turn_index: 7,
        sample_rate: 1,
        session_role: "root",
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
