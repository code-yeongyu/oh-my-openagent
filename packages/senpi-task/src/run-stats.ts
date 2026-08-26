import type { ManagedChildEvent } from "./manager/child-handle"
import type { CostReportStatus, TaskRunStats, TokenCoverageStatus } from "./state"

export type RunStatsTracker = {
  accept(event: ManagedChildEvent): boolean
  snapshot(now: number): TaskRunStats
}

// Accumulates run facts from the managed child event stream. A generation window opens at the last
// boundary (spawn, assistant message_start, tool_execution_end, previous message_end) and closes on
// an assistant message_end, so tokens_per_second measures streaming speed and excludes tool time.
export function createRunStatsTracker(startedAt: number, now: () => number = Date.now): RunStatsTracker {
  let turns = 0
  let toolCalls = 0
  let outputTokens = 0
  let totalTokens = 0
  let generationMs = 0
  let collapsedWindows = 0
  let windowStart = startedAt
  let costUsd = 0
  let sawCost = false
  let inputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let cacheableTokens = 0
  let turnsReportingUsage = 0
  let latestCacheHitRate: number | undefined
  const evalRunCallIds = new Set<string>()
  let anonymousEvalRuns = 0

  return {
    accept(event) {
      if (event.type === "tool_execution_start") {
        toolCalls += 1
        const evalInput = event.args ?? event.input
        const isEvalRun =
          event.toolName === "eval" &&
          (!isRecord(evalInput) || (evalInput.action !== "peek" && evalInput.action !== "stop"))
        if (isEvalRun) {
          if (event.toolCallId === undefined) anonymousEvalRuns += 1
          else evalRunCallIds.add(event.toolCallId)
        }
        return true
      }
      if (event.type === "tool_execution_end") {
        let countNestedEvalTools = false
        if (event.toolName === "eval") {
          if (event.toolCallId !== undefined) countNestedEvalTools = evalRunCallIds.delete(event.toolCallId)
          else if (anonymousEvalRuns > 0) {
            anonymousEvalRuns -= 1
            countNestedEvalTools = true
          }
        }
        const details =
          countNestedEvalTools && isRecord(event.result) && isRecord(event.result.details)
            ? event.result.details
            : undefined
        const nestedEvalTools = Array.isArray(details?.toolCalls)
          ? details.toolCalls.filter(
              (call) =>
                isRecord(call) &&
                typeof call.name === "string" &&
                call.name.length > 0 &&
                typeof call.ok === "boolean",
            ).length
          : 0
        toolCalls += nestedEvalTools
        windowStart = now()
        return nestedEvalTools > 0
      }
      if (event.type === "message_start") {
        if (isAssistantMessage(event.message)) windowStart = now()
        return false
      }
      if (event.type !== "message_end" || !isAssistantMessage(event.message)) return false
      // Windows are measured on the arrival clock: AssistantMessage.timestamp marks message
      // creation (stream start), not completion, so it cannot close a generation window.
      const timestamp = now()
      turns += 1
      const window = Math.max(0, timestamp - windowStart)
      generationMs += window
      windowStart = timestamp
      const usage = readUsage(event.message)
      if (Object.keys(usage).length > 0) turnsReportingUsage += 1
      if (window === 0 && (usage.output ?? 0) > 0) collapsedWindows += 1
      outputTokens += usage.output ?? 0
      totalTokens += usage.total ?? 0
      if (usage.cost !== undefined) {
        costUsd += usage.cost
        sawCost = true
      }
      const requestCacheReadTokens = usage.cacheRead ?? 0
      const requestCacheWriteTokens = usage.cacheWrite ?? 0
      const requestCacheableTokens = (usage.input ?? 0) + requestCacheReadTokens + requestCacheWriteTokens
      const requestCacheHitRate = boundedCacheHitRate(requestCacheReadTokens, requestCacheableTokens)
      if (requestCacheHitRate !== undefined) latestCacheHitRate = requestCacheHitRate
      inputTokens += usage.input ?? 0
      cacheReadTokens += requestCacheReadTokens
      cacheWriteTokens += requestCacheWriteTokens
      cacheableTokens += requestCacheableTokens
      return true
    },
    snapshot(nowMs) {
      const runtimeMs = Math.max(0, nowMs - startedAt)
      // Generation throughput contract: `tokens_per_second` is emitted ONLY when every
      // token-bearing generation window has a non-zero measured duration, so the figure reflects
      // streaming speed and nothing else. When any token-bearing window collapsed to zero
      // (post-hoc RPC burst, clock coalescing, etc.), the timing for that portion of the output
      // is irrecoverably lost — dividing total tokens by only the surviving measured windows
      // would overstate throughput, and dividing by runtime would conflate streaming speed with
      // tool/idle time. Either way the number is unverifiable, so `tokens_per_second` is omitted.
      //
      // The runtime fallback survives ONLY for the no-measured-window case where no
      // token-bearing collapsed window exists (i.e. outputTokens is zero or every window was
      // zero-token): there the runtime is the sole available timing signal and no collapsed
      // token timing has been lost.
      const throughputWindowMs =
        collapsedWindows > 0 ? undefined : generationMs > 0 ? generationMs : runtimeMs
      const tps = throughputWindowMs === undefined ? undefined : tokensPerSecond(outputTokens, throughputWindowMs)
      const runCacheHitRate = boundedCacheHitRate(cacheReadTokens, cacheableTokens)
      const costReported = sawCost && Number.isFinite(costUsd)
      return {
        runtime_ms: runtimeMs,
        turns,
        tool_calls: toolCalls,
        // The tracker measures this run from its own injected clock, so the duration is active
        // execution time. Reconstructed durations (reconciled records) are the consumer's job.
        duration_status: "monotonic",
        token_status: tokenCoverage(turns, turnsReportingUsage),
        cost_status: costStatus(sawCost, costReported),
        ...positiveFiniteTotal("output_tokens", outputTokens),
        ...positiveFiniteTotal("input_tokens", inputTokens),
        ...positiveFiniteTotal("cache_read_tokens", cacheReadTokens),
        ...positiveFiniteTotal("cache_write_tokens", cacheWriteTokens),
        ...positiveFiniteTotal("total_tokens", totalTokens),
        ...(generationMs > 0 ? { generation_ms: generationMs } : {}),
        ...(tps === undefined ? {} : { tokens_per_second: tps }),
        ...(costReported ? { cost_usd: costUsd } : {}),
        ...(latestCacheHitRate === undefined ? {} : { cache_hit_rate_last: latestCacheHitRate }),
        ...(runCacheHitRate === undefined ? {} : { cache_hit_rate_run: runCacheHitRate }),
      }
    },
  }
}

// Cumulative sums of individually finite per-turn values can still overflow to Infinity; an
// overflowed total is not a token count, so it is omitted rather than persisted as null.
function positiveFiniteTotal<K extends string>(key: K, total: number): Partial<Record<K, number>> {
  return total > 0 && Number.isFinite(total) ? ({ [key]: total } as Record<K, number>) : {}
}

// Usage coverage is per assistant turn: a run where every turn reported usage sums to exact
// totals, one where only some did is a lower bound, and one where none did has no token facts.
function tokenCoverage(turns: number, turnsReportingUsage: number): TokenCoverageStatus {
  if (turnsReportingUsage === 0) return "unavailable"
  return turnsReportingUsage === turns ? "complete" : "partial"
}

// A cost the provider never reported is unavailable, not zero; a reported-but-non-finite sum is
// invalid, so aggregates can exclude it instead of poisoning a SUM with NaN/Infinity.
function costStatus(sawCost: boolean, costReported: boolean): CostReportStatus {
  if (costReported) return "reported"
  return sawCost ? "invalid" : "unavailable"
}

export function tokensPerSecond(outputTokens: number, generationMs: number): number | undefined {
  if (outputTokens <= 0 || generationMs <= 0) return undefined
  const raw = outputTokens / (generationMs / 1_000)
  return raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10
}

function boundedCacheHitRate(cacheReadTokens: number, cacheableTokens: number): number | undefined {
  if (!Number.isFinite(cacheReadTokens) || !Number.isFinite(cacheableTokens) || cacheableTokens <= 0) {
    return undefined
  }
  const rate = cacheReadTokens / cacheableTokens
  return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : undefined
}

function isAssistantMessage(message: unknown): message is Record<string, unknown> {
  return isRecord(message) && message.role === "assistant"
}

type UsageFacts = {
  readonly output?: number
  readonly total?: number
  readonly cost?: number
  readonly input?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

function readUsage(message: Record<string, unknown>): UsageFacts {
  const usage = message.usage
  if (!isRecord(usage)) return {}
  return {
    ...optionalNumber("output", firstFiniteNonNegativeNumber(usage.output, usage.output_tokens)),
    ...optionalNumber("total", firstFiniteNonNegativeNumber(usage.totalTokens, usage.total_tokens)),
    ...optionalNumber("cost", readCost(usage.cost)),
    ...optionalNumber("input", firstFiniteNonNegativeNumber(usage.input, usage.input_tokens)),
    ...optionalNumber("cacheRead", firstFiniteNonNegativeNumber(usage.cacheRead, usage.cache_read_input_tokens)),
    ...optionalNumber(
      "cacheWrite",
      firstFiniteNonNegativeNumber(usage.cacheWrite, usage.cache_creation_input_tokens),
    ),
  }
}

// Senpi reports cost either as a plain number or as a per-bucket breakdown carrying `.total`.
function readCost(value: unknown): number | undefined {
  return firstFiniteNonNegativeNumber(isRecord(value) ? value.total : value)
}

function optionalNumber<K extends string>(key: K, value: number | undefined): Partial<Record<K, number>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, number>)
}

function firstFiniteNonNegativeNumber(...values: readonly unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
