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
        // Build a resolved model from the selector so the live status line retains the
        // provider/model_id structure and any thinking level encoded in the selector suffix.
        // When the Senpi core event carries an explicit thinking field, prefer that over the
        // selector suffix so the display reflects the actually-applied level even when the
        // selector was normalized without it.
        const parsed = parseModelSelector(event.to, resolvedModel?.source ?? "category")
        const eventThinking = readEventString(event, "thinking")
        if (parsed !== undefined) {
          resolvedModel = eventThinking !== undefined
            ? { ...parsed, reasoning: eventThinking, reasoning_effort: eventThinking }
            : parsed
          model = parsed.display
        } else {
          resolvedModel = undefined
          model = event.to
        }
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

function readEventString(event: ManagedChildEvent, key: string): string | undefined {
  const value = Reflect.get(event, key)
  return typeof value === "string" && value.length > 0 ? value : undefined
}

// Parse a "provider/model_id" or "provider/model_id:reasoning" selector into a ResolvedModelRecord.
// Mirrors runtime-fallback-event.ts parseModelSelector so the live progress tracker preserves
// the thinking level that the task record store already retains.
function parseModelSelector(
  selector: string,
  source: ResolvedModelRecord["source"],
): ResolvedModelRecord | undefined {
  const slash = selector.indexOf("/")
  if (slash <= 0 || slash === selector.length - 1) return undefined
  const colon = selector.lastIndexOf(":")
  const hasThinking = colon > slash
  const display = hasThinking ? selector.slice(0, colon) : selector
  return {
    source,
    provider: display.slice(0, slash),
    model_id: display.slice(slash + 1),
    display,
    ...(hasThinking
      ? { reasoning: selector.slice(colon + 1), reasoning_effort: selector.slice(colon + 1) }
      : {}),
  }
}
