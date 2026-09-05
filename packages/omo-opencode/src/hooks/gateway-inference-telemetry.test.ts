const { describe, expect, test } = require("bun:test")
import {
  formatGatewayTelemetryLine,
  preferGatewayInferenceTelemetry,
} from "../shared/gateway-inference-telemetry"

describe("preferGatewayInferenceTelemetry", () => {
  test("#given gateway usage tok/s and cost #when formatted #then it prefers those fields", () => {
    const telemetry = preferGatewayInferenceTelemetry({
      info: {
        cost: 9.99,
        modelID: "requested-combo",
        usage: { cost: 0.0123, tokens_per_second: 80.5, model: "winner-model" },
      },
    })
    expect(telemetry).toEqual({
      costUsd: 0.0123,
      tokensPerSecond: 80.5,
      model: "winner-model",
    })
    expect(formatGatewayTelemetryLine(telemetry)).toBe("cost $0.0123 · tok/s 80.5 · model winner-model")
  })

  test("#given only catalog cost and latency #when formatted #then tok/s is em dash", () => {
    const telemetry = preferGatewayInferenceTelemetry({
      info: {
        cost: 1.5,
        modelID: "requested",
        usage: { completion_tokens: 200, latency_ms: 2000 },
      },
    })
    expect(telemetry.tokensPerSecond).toBeUndefined()
    expect(formatGatewayTelemetryLine(telemetry)).toBe("cost $1.5 · tok/s — · model requested")
  })
})

export {}
