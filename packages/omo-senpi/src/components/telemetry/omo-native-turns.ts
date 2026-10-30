import type { TurnEndEvent } from "@code-yeongyu/senpi"
import type {
  EventTelemetryClient,
  TelemetryDiagnosticInput,
} from "@oh-my-opencode/telemetry-core"
import {
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
  maskProviderAndModel,
} from "./product-identity"
import type { SessionSummaryRecorder } from "./omo-native-session-summary"
import type { TelemetrySessionRole } from "./session-role"
import { usdOf } from "./session-summary-window"

export type OmoNativeTurnHandlerOptions = {
  readonly client: Pick<EventTelemetryClient, "captureEvent">
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  /** The consent gate, read at send time: sampling is decided per session, long before a turn ends. */
  readonly isConsented: () => boolean
  readonly sessionId: string
  readonly sessionRole: TelemetrySessionRole
  readonly summary: SessionSummaryRecorder
}

type TurnCompletedProperty = (typeof OMO_NATIVE_PROPERTY_ALLOWLISTS.turn_completed)[number]
type NumberResult = { readonly value: number; readonly valid: boolean }

export function createOmoNativeTurnHandler(
  options: OmoNativeTurnHandlerOptions,
): (event: TurnEndEvent) => void {
  return (event) => {
    if (event.message.role !== "assistant") return

    const usage = asRecord(event.message.usage)
    const cost = asRecord(usage?.["cost"])
    const input = nonNegativeNumber(usage?.["input"])
    const output = nonNegativeNumber(usage?.["output"])
    const cacheRead = nonNegativeNumber(usage?.["cacheRead"])
    const cacheWrite = nonNegativeNumber(usage?.["cacheWrite"])
    const reasoning = optionalNonNegativeNumber(usage?.["reasoning"])
    const total = nonNegativeNumber(usage?.["totalTokens"])
    const costTotal = nonNegativeNumber(cost?.["total"])
    const masked = maskProviderAndModel(event.message.provider, event.message.model)
    const cost1e4 = toCost1e4(costTotal.value)
    const properties = {
      $session_id: options.sessionId,
      provider: masked.provider,
      model_id: masked.model_id,
      input_tokens: input.value,
      output_tokens: output.value,
      cache_read_tokens: cacheRead.value,
      cache_write_tokens: cacheWrite.value,
      reasoning_tokens: reasoning.value,
      total_tokens: total.value,
      cost_1e4: cost1e4,
      cost_usd: usdOf(cost1e4),
      turn_index: event.turnIndex,
      sample_rate: options.summary.sampleRate,
      session_role: options.sessionRole,
    } satisfies Record<TurnCompletedProperty, string | number>

    const usageValid = [input, output, cacheRead, cacheWrite, reasoning, total, costTotal].every(({ valid }) => valid)
    void options.summary.recordTurn(options.sessionId, {
      turnIndex: event.turnIndex,
      provider: masked.provider,
      modelId: masked.model_id,
      inputTokens: input.value,
      outputTokens: output.value,
      cacheReadTokens: cacheRead.value,
      cacheWriteTokens: cacheWrite.value,
      reasoningTokens: reasoning.value,
      totalTokens: total.value,
      cost1e4,
      usageValid,
      stopReason: stopReasonOf(event.message),
      toolResultCount: Array.isArray(event.toolResults) ? event.toolResults.length : 0,
      toolErrorCount: Array.isArray(event.toolResults)
        ? event.toolResults.filter((result) => asRecord(result)?.["isError"] === true).length
        : 0,
    })

    if (!usageValid) {
      options.diagnostics?.({
        event: "telemetry_event_property_rejected",
        source: "omo-native-turns",
        error: new Error("turn_end assistant usage contained missing or invalid values"),
        errorKind: "error",
      })
    }
    if (options.summary.isRawTurnSampled(options.sessionId) && options.isConsented()) {
      options.client.captureEvent("turn_completed", properties)
    }
  }
}

function stopReasonOf(message: unknown): string | undefined {
  const reason = asRecord(message)?.["stopReason"]
  return typeof reason === "string" ? reason : undefined
}

function nonNegativeNumber(value: unknown): NumberResult {
  const valid = typeof value === "number" && Number.isFinite(value) && value >= 0
  return { value: valid ? value : 0, valid }
}

function optionalNonNegativeNumber(value: unknown): NumberResult {
  return value === undefined ? { value: 0, valid: true } : nonNegativeNumber(value)
}

// The ONLY rounding step for cost: every downstream total adds these integers, so a summary and the sum of
// its raw turns agree exactly, in any summation order, and cost_usd can never disagree with cost_1e4.
// It rounds half-up on the decimal digits of the reported number, not on the binary product
// `costUsd * 10_000`: 0.00015 * 1e4 is 1.4999999999999998 in binary, which `Math.round` takes to 1.
export function toCost1e4(costUsd: number): number {
  const [mantissa = "0", exponent = "0"] = costUsd.toString().split("e")
  const [whole = "0", fraction = ""] = mantissa.split(".")
  const digits = whole + fraction
  const point = whole.length + Number(exponent) + 4
  if (point < 0) return 0
  const padded = digits.padEnd(point + 1, "0")
  const scaled = point === 0 ? 0 : Number(padded.slice(0, point))
  return padded.charAt(point) >= "5" ? scaled + 1 : scaled
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}
