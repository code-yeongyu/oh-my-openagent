import {
  COST_REPORT_STATUSES,
  DURATION_SOURCE_STATUSES,
  TOKEN_COVERAGE_STATUSES,
  type CostReportStatus,
  type DurationSourceStatus,
  type TaskRunStats,
  type TokenCoverageStatus,
} from "../state"
import { isRecord, readNumber, readOptionalNumber, readOptionalString } from "./scalar-read"

// Parses the persisted run_stats block. Every optional field is absent-tolerant (records written
// before a field shipped stay valid) but type-strict (a present field of the wrong shape rejects
// the record, so a corrupted stat can never masquerade as a measurement).
export function parseRunStats(value: unknown): TaskRunStats {
  if (!isRecord(value)) throw new Error("run_stats is not an object")
  const outputTokens = readOptionalNumber(value, "output_tokens")
  const inputTokens = readOptionalNumber(value, "input_tokens")
  const cacheReadTokens = readOptionalNumber(value, "cache_read_tokens")
  const cacheWriteTokens = readOptionalNumber(value, "cache_write_tokens")
  const totalTokens = readOptionalNumber(value, "total_tokens")
  const generationMs = readOptionalNumber(value, "generation_ms")
  const tokensPerSecond = readOptionalNumber(value, "tokens_per_second")
  const costUsd = readOptionalNumber(value, "cost_usd")
  const cacheHitRateLast = readOptionalNumber(value, "cache_hit_rate_last")
  const cacheHitRateRun = readOptionalNumber(value, "cache_hit_rate_run")
  const legacyCacheHitRate = readOptionalNumber(value, "cache_hit_rate")
  const resolvedCacheHitRateRun = cacheHitRateRun ?? legacyCacheHitRate
  const tokenStatus = readTokenStatus(value)
  const costStatus = readCostStatus(value)
  const durationStatus = readDurationStatus(value)
  return {
    runtime_ms: readNumber(value, "runtime_ms"),
    turns: readNumber(value, "turns"),
    tool_calls: readNumber(value, "tool_calls"),
    ...(outputTokens === undefined ? {} : { output_tokens: outputTokens }),
    ...(inputTokens === undefined ? {} : { input_tokens: inputTokens }),
    ...(cacheReadTokens === undefined ? {} : { cache_read_tokens: cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cache_write_tokens: cacheWriteTokens }),
    ...(totalTokens === undefined ? {} : { total_tokens: totalTokens }),
    ...(generationMs === undefined ? {} : { generation_ms: generationMs }),
    ...(tokensPerSecond === undefined ? {} : { tokens_per_second: tokensPerSecond }),
    ...(costUsd === undefined ? {} : { cost_usd: costUsd }),
    ...(cacheHitRateLast === undefined ? {} : { cache_hit_rate_last: cacheHitRateLast }),
    ...(resolvedCacheHitRateRun === undefined ? {} : { cache_hit_rate_run: resolvedCacheHitRateRun }),
    ...(tokenStatus === undefined ? {} : { token_status: tokenStatus }),
    ...(costStatus === undefined ? {} : { cost_status: costStatus }),
    ...(durationStatus === undefined ? {} : { duration_status: durationStatus }),
  }
}

function readTokenStatus(record: Record<string, unknown>): TokenCoverageStatus | undefined {
  const status = readOptionalString(record, "token_status")
  if (status === undefined) return undefined
  switch (status) {
    case "complete":
    case "partial":
    case "unavailable":
      return status
    default:
      throw new Error(`run_stats.token_status must be one of ${TOKEN_COVERAGE_STATUSES.join(", ")}`)
  }
}

function readCostStatus(record: Record<string, unknown>): CostReportStatus | undefined {
  const status = readOptionalString(record, "cost_status")
  if (status === undefined) return undefined
  switch (status) {
    case "reported":
    case "unavailable":
    case "invalid":
      return status
    default:
      throw new Error(`run_stats.cost_status must be one of ${COST_REPORT_STATUSES.join(", ")}`)
  }
}

function readDurationStatus(record: Record<string, unknown>): DurationSourceStatus | undefined {
  const status = readOptionalString(record, "duration_status")
  if (status === undefined) return undefined
  switch (status) {
    case "monotonic":
    case "wall_clock":
    case "unavailable":
      return status
    default:
      throw new Error(`run_stats.duration_status must be one of ${DURATION_SOURCE_STATUSES.join(", ")}`)
  }
}

