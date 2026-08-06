import type { ManagedChildEvent } from "./manager/child-handle"
import { createRunStatsTracker } from "./run-stats"
import type { ResolvedModelRecord } from "./state"
import { composeStatusLine, formatStatusTarget, taskIdentityLabel } from "./status-line"

export type ToolProgressDetails = {
  readonly progress: {
    readonly activity: string
    readonly startedAt: number
  }
  readonly childId: string
  readonly currentTool?: string
  readonly lastAssistantLine?: string
  readonly turns: number
  readonly toolCalls?: number
  readonly tokens?: number
  readonly outputTokens?: number
  readonly tokensPerSecond?: number
}

export type ChildProgressTarget = {
  readonly category?: string
  readonly agentType?: string
  readonly resolvedModel?: ResolvedModelRecord
  readonly model?: string
  readonly name?: string
  readonly description?: string
  readonly taskSummary?: string
}

type ChildProgress = {
  accept(event: ManagedChildEvent): boolean
  details(): ToolProgressDetails
  // The partial-result content row. The composed status line intentionally lives ONLY in
  // details.progress.activity: senpi's ToolExecutionRenderer already draws that line below the
  // result, so echoing it in content would render the same status twice.
  contentText(): string
}

export function createChildProgress(
  taskId: string,
  target: ChildProgressTarget,
  startedAt: number,
  now: () => number = Date.now,
): ChildProgress {
  const tracker = createRunStatsTracker(startedAt, now)
  let currentTool: string | undefined
  let lastAssistantLine: string | undefined
  let lastTotalTokens: number | undefined
  let resolvedModel = target.resolvedModel
  let model = target.model
  let fallbackCount = 0

  const activity = (stats: ReturnType<typeof tracker.snapshot>): string =>
    composeStatusLine({
      identity: taskIdentityLabel({ taskId, name: target.name, description: target.description, taskSummary: target.taskSummary }),
      target: formatStatusTarget({
        category: target.category,
        agentType: target.agentType,
        resolvedModel,
        model,
        fallbackCount,
      }),
      stats,
      verb: currentTool === undefined ? "running" : `running ${currentTool}`,
    })

  return {
    accept(event): boolean {
      const statsChanged = tracker.accept(event)
      if (event.type === "retry_fallback_applied" && event.to !== undefined) {
        resolvedModel = undefined
        model = event.to
        fallbackCount += 1
        return true
      }
      if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
        currentTool = formatToolActivity(event.toolName, event.args ?? event.input)
        return true
      }
      if (event.type === "tool_execution_end") {
        if (currentTool === undefined) return statsChanged
        currentTool = undefined
        return true
      }
      if (event.type !== "message_end") return statsChanged
      const line = assistantLastLine(event.message)
      if (line === undefined) return statsChanged
      lastAssistantLine = line
      lastTotalTokens = readTokens(event.message) ?? lastTotalTokens
      return true
    },
    details(): ToolProgressDetails {
      const stats = tracker.snapshot(now())
      return {
        progress: { activity: activity(stats), startedAt },
        childId: taskId,
        ...(currentTool === undefined ? {} : { currentTool }),
        ...(lastAssistantLine === undefined ? {} : { lastAssistantLine }),
        turns: stats.turns,
        toolCalls: stats.tool_calls,
        ...(lastTotalTokens === undefined ? {} : { tokens: lastTotalTokens }),
        ...(stats.output_tokens === undefined ? {} : { outputTokens: stats.output_tokens }),
        ...(stats.tokens_per_second === undefined ? {} : { tokensPerSecond: stats.tokens_per_second }),
      }
    },
    contentText(): string {
      return lastAssistantLine === undefined ? "" : `↳ last: ${lastAssistantLine}`
    },
  }
}

export function readToolProgressDetails(value: unknown): ToolProgressDetails | undefined {
  if (!isRecord(value) || !isRecord(value.progress)) return undefined
  if (typeof value.progress.activity !== "string" || typeof value.progress.startedAt !== "number") return undefined
  if (typeof value.childId !== "string" || typeof value.turns !== "number") return undefined
  if (value.currentTool !== undefined && typeof value.currentTool !== "string") return undefined
  if (value.lastAssistantLine !== undefined && typeof value.lastAssistantLine !== "string") return undefined
  const optionalNumbers = [value.toolCalls, value.tokens, value.outputTokens, value.tokensPerSecond]
  if (optionalNumbers.some((entry) => entry !== undefined && typeof entry !== "number")) return undefined
  return value as ToolProgressDetails
}

// The `running <tool>` fragment of the live status line, e.g. `read src/foo.ts`.
export function formatToolActivity(toolName: string, args: unknown): string {
  const argument = oneLineArgument(args)
  return argument.length === 0 ? toolName : `${toolName} ${argument}`
}

// The last non-empty line of an assistant message, bounded for a single status row.
export function assistantLastLine(message: unknown): string | undefined {
  const text = assistantText(message)
  return text === undefined ? undefined : truncate(lastNonEmptyLine(text), 120)
}

function oneLineArgument(value: unknown): string {
  if (typeof value === "string") return truncate(value.replace(/\s+/g, " ").trim(), 80)
  if (!isRecord(value)) return ""
  const first = Object.values(value).find((item) => typeof item === "string")
  return typeof first === "string" ? truncate(first.replace(/\s+/g, " ").trim(), 80) : ""
}

function assistantText(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== "assistant" || !Array.isArray(message.content)) return undefined
  const text = message.content
    .filter((part): part is { readonly type: "text"; readonly text: string } => isTextPart(part))
    .map((part) => part.text)
    .join("")
  return text.length === 0 ? undefined : text
}

function readTokens(message: unknown): number | undefined {
  if (!isRecord(message) || !isRecord(message.usage)) return undefined
  const usage = message.usage
  const candidates = [usage.totalTokens, usage.total_tokens]
  return candidates.find((value): value is number => typeof value === "number")
}

function lastNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).findLast((line) => line.trim().length > 0)?.trim() ?? ""
}

function truncate(text: string, maximum: number): string {
  return text.length <= maximum ? text : `${text.slice(0, maximum - 1)}…`
}

function isTextPart(value: unknown): value is { readonly type: "text"; readonly text: string } {
  return isRecord(value) && value.type === "text" && typeof value.text === "string"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
