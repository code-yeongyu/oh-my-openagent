export type GatewayInferenceTelemetry = {
  costUsd?: number
  tokensPerSecond?: number
  model?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function readPositiveNumber(value: unknown): number | undefined {
  const parsed = readFiniteNumber(value)
  if (parsed === undefined || parsed <= 0) return undefined
  return parsed
}

export function preferGatewayInferenceTelemetry(message: {
  info?: Record<string, unknown>
}): GatewayInferenceTelemetry {
  const info = message.info ?? {}
  const usage = isRecord(info.usage) ? info.usage : {}
  const cost =
    readFiniteNumber(usage.cost) ??
    readFiniteNumber(info.cost)
  const tokensPerSecond =
    readPositiveNumber(usage.tokens_per_second) ??
    readPositiveNumber(usage.tokensPerSecond) ??
    readPositiveNumber(info.tokens_per_second)
  const model =
    (typeof usage.model === "string" && usage.model.trim() ? usage.model.trim() : undefined) ??
    (typeof info.modelID === "string" && info.modelID.trim() ? info.modelID.trim() : undefined)
  const out: GatewayInferenceTelemetry = {}
  if (cost !== undefined && cost >= 0) out.costUsd = cost
  if (tokensPerSecond !== undefined) out.tokensPerSecond = tokensPerSecond
  if (model) out.model = model
  return out
}

export function formatGatewayTelemetryLine(telemetry: GatewayInferenceTelemetry): string {
  if (
    telemetry.costUsd === undefined &&
    telemetry.tokensPerSecond === undefined &&
    telemetry.model === undefined
  ) {
    return ""
  }
  const cost =
    telemetry.costUsd === undefined ? "cost —" : `cost $${telemetry.costUsd}`
  const tps =
    telemetry.tokensPerSecond === undefined ? "tok/s —" : `tok/s ${telemetry.tokensPerSecond}`
  const model = telemetry.model ? `model ${telemetry.model}` : undefined
  return [cost, tps, model].filter(Boolean).join(" · ")
}
