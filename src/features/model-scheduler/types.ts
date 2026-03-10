import type { ModelSchedulerConfig, ModelSchedulerMode } from "../../config"

export type RoutingTargetKind = "agent" | "category"
export type HealthStatus = "healthy" | "offline" | "degraded" | "unknown"
export type SchedulerChangeReason =
  | "existing-fallback"
  | "requirements-fallback"
  | "unavailable"
  | "probe-failed"
  | "latency-too-high"

export type ModelProbeStatus = "healthy" | "unavailable" | "timeout" | "error" | "slow" | "skipped"

export type ModelProbeResult = {
  model: string
  available: boolean
  status: ModelProbeStatus
  checkedAt: string
  latencyMs?: number
  error?: string
}

export type RoutingTargetHealth = {
  key: string
  displayName: string
  kind: RoutingTargetKind
  currentModel: string | null
  status: HealthStatus
  selectedModel: string | null
  changed: boolean
  reason: SchedulerChangeReason
  checkedAt: string
  cooldownUntil?: string
  consecutiveFailures: number
  consecutiveSuccesses: number
  availabilityStatus?: "available" | "unavailable"
  probeStatus?: ModelProbeStatus
  probeLatencyMs?: number
  probeError?: string
}

export type ModelHealthSnapshot = {
  version: 2
  mode: ModelSchedulerMode
  updatedAt: string
  connectedProviders: string[]
  availableModelCount: number
  inventory: {
    added: Record<string, string[]>
    removed: Record<string, string[]>
  }
  agents: Record<string, RoutingTargetHealth>
  categories: Record<string, RoutingTargetHealth>
  probe: {
    enabled: boolean
    timeoutMs: number
    maxLatencyMs: number
    checkedModelCount: number
    healthyModelCount: number
    models: Record<string, ModelProbeResult>
  }
}

export type ModelSchedulerAuditEntry = {
  timestamp: string
  mode: ModelSchedulerMode
  changed: boolean
  availableModelCount: number
  connectedProviders: string[]
  probeSummary?: {
    enabled: boolean
    checkedModelCount: number
    healthyModelCount: number
  }
  changes: Array<{
    kind: RoutingTargetKind
    key: string
    from: string | null
    to: string | null
    reason: SchedulerChangeReason
  }>
}

export type RoutingEntry = {
  primary?: string
  fallback?: string[]
  reason?: string
}

export type ModelRoutingFile = {
  version?: string
  lastUpdated?: string
  note?: string
  providerSummary?: Record<string, string>
  agentModelMapping?: Record<string, RoutingEntry>
  categoryRouting?: Record<string, string>
  summary?: Record<string, unknown>
  scheduler?: {
    lastRunAt?: string
    lastMode?: ModelSchedulerMode
    lastChangeCount?: number
  }
}

export type SchedulerRunResult = {
  snapshot: ModelHealthSnapshot
  auditEntry: ModelSchedulerAuditEntry
}

export type ResolvedModelSchedulerConfig = Required<ModelSchedulerConfig>
