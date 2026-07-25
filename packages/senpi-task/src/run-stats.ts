import type { ManagedChildEvent } from "./manager/child-handle"
import type { TaskRunStats } from "./state"

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

  return {
    accept(event) {
      if (event.type === "tool_execution_start") {
        toolCalls += 1
        return true
      }
      if (event.type === "tool_execution_end") {
        windowStart = now()
        return false
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
      if (window === 0 && (usage.output ?? 0) > 0) collapsedWindows += 1
      outputTokens += usage.output ?? 0
      totalTokens += usage.total ?? 0
      return true
    },
    snapshot(nowMs) {
      const runtimeMs = Math.max(0, nowMs - startedAt)
      // RPC delivery can arrive in a post-hoc burst, collapsing measured generation windows to
      // zero. Whenever any token-bearing window collapsed (or none was measured at all), fall
      // back to total runtime so throughput stays a conservative lower bound instead of either
      // disappearing or being divided by only the windows that happened to measure.
      const throughputWindowMs = collapsedWindows > 0 || generationMs === 0 ? runtimeMs : generationMs
      const tps = tokensPerSecond(outputTokens, throughputWindowMs)
      return {
        runtime_ms: runtimeMs,
        turns,
        tool_calls: toolCalls,
        ...(outputTokens > 0 ? { output_tokens: outputTokens } : {}),
        ...(totalTokens > 0 ? { total_tokens: totalTokens } : {}),
        ...(generationMs > 0 ? { generation_ms: generationMs } : {}),
        ...(tps === undefined ? {} : { tokens_per_second: tps }),
      }
    },
  }
}

export function tokensPerSecond(outputTokens: number, generationMs: number): number | undefined {
  if (outputTokens <= 0 || generationMs <= 0) return undefined
  const raw = outputTokens / (generationMs / 1_000)
  return raw >= 10 ? Math.round(raw) : Math.round(raw * 10) / 10
}

function isAssistantMessage(message: unknown): message is Record<string, unknown> {
  return isRecord(message) && message.role === "assistant"
}

function readUsage(message: Record<string, unknown>): { readonly output?: number; readonly total?: number } {
  const usage = message.usage
  if (!isRecord(usage)) return {}
  return {
    ...(firstNumber(usage.output, usage.output_tokens) === undefined
      ? {}
      : { output: firstNumber(usage.output, usage.output_tokens) }),
    ...(firstNumber(usage.totalTokens, usage.total_tokens) === undefined
      ? {}
      : { total: firstNumber(usage.totalTokens, usage.total_tokens) }),
  }
}

function firstNumber(...values: readonly unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
