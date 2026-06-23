import type { ReasoningCoreTransport } from "./transport-interface"
import { createHttpTransport, probeHttpHealth } from "./http-transport"
import { createStdioProcessPool } from "./stdio-process-pool"

export type TransportMode = "auto" | "http" | "stdio"

export interface TransportFactoryConfig {
  mode: TransportMode
  httpEndpoint: string
  binaryPath: string
  poolSize: number
  timeoutMs: number
  healthProbeTimeoutMs?: number
}

const DEFAULT_HEALTH_PROBE_TIMEOUT_MS = 500

export async function createTransport(config: TransportFactoryConfig): Promise<ReasoningCoreTransport> {
  if (config.mode === "http") {
    return createHttpTransport({ endpoint: config.httpEndpoint, timeoutMs: config.timeoutMs })
  }

  if (config.mode === "stdio") {
    return createStdioProcessPool({
      binaryPath: config.binaryPath,
      poolSize: config.poolSize,
      timeoutMs: config.timeoutMs,
    })
  }

  const probeTimeout = config.healthProbeTimeoutMs ?? DEFAULT_HEALTH_PROBE_TIMEOUT_MS
  const httpHealthy = await probeHttpHealth(config.httpEndpoint, probeTimeout)
  if (httpHealthy) {
    return createHttpTransport({ endpoint: config.httpEndpoint, timeoutMs: config.timeoutMs })
  }

  return createStdioProcessPool({
    binaryPath: config.binaryPath,
    poolSize: config.poolSize,
    timeoutMs: config.timeoutMs,
  })
}
