import type { TurnEndEvent } from "@code-yeongyu/senpi"
import type {
  EventTelemetryClient,
  TelemetryDiagnosticInput,
} from "@oh-my-opencode/telemetry-core"
import {
  KNOWN_MODELS,
  KNOWN_PROVIDERS,
  OMO_NATIVE_PROPERTY_ALLOWLISTS,
} from "./product-identity"

export type OmoNativeTurnHandlerOptions = {
  readonly client: Pick<EventTelemetryClient, "captureEvent">
  readonly diagnostics?: (input: TelemetryDiagnosticInput) => void
  readonly sessionId: string
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
    const masked = maskModel(event.message.provider, event.message.model)
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
      cost_usd: roundToFourDecimals(costTotal.value),
      turn_index: event.turnIndex,
    } satisfies Record<TurnCompletedProperty, string | number>

    if (![input, output, cacheRead, cacheWrite, reasoning, total, costTotal].every(({ valid }) => valid)) {
      options.diagnostics?.({
        event: "telemetry_event_property_rejected",
        source: "omo-native-turns",
        error: new Error("turn_end assistant usage contained missing or invalid values"),
        errorKind: "error",
      })
    }
    options.client.captureEvent("turn_completed", properties)
  }
}

export function maskModel(provider: string, modelId: string): { provider: string; model_id: string } {
  const providerIsKnown = KNOWN_PROVIDERS.some((known) => known === provider)
  const providerModels: unknown = Reflect.get(KNOWN_MODELS, provider)
  const modelIsKnown = Array.isArray(providerModels) && providerModels.some((known) => known === modelId)
  return {
    provider: providerIsKnown ? provider : "custom",
    model_id: modelIsKnown ? modelId : "custom",
  }
}

function nonNegativeNumber(value: unknown): NumberResult {
  const valid = typeof value === "number" && Number.isFinite(value) && value >= 0
  return { value: valid ? value : 0, valid }
}

function optionalNonNegativeNumber(value: unknown): NumberResult {
  return value === undefined ? { value: 0, valid: true } : nonNegativeNumber(value)
}

function roundToFourDecimals(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined
}
