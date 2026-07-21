import type { ManagedChildEvent } from "./manager/child-handle"

export type ToolProgressDetails = {
  readonly progress: {
    readonly activity: string
    readonly startedAt: number
  }
  readonly childId: string
  readonly currentTool?: string
  readonly lastAssistantLine?: string
  readonly turns: number
  readonly tokens?: number
}

type ChildProgress = {
  accept(event: ManagedChildEvent): boolean
  details(): ToolProgressDetails
  text(now: number): string
}

export function createChildProgress(taskId: string, category: string | undefined, startedAt: number): ChildProgress {
  let currentTool: string | undefined
  let lastAssistantLine: string | undefined
  let turns = 0
  let tokens: number | undefined

  const activity = (): string => currentTool === undefined ? "running" : `running ${currentTool}`
  const details = (): ToolProgressDetails => ({
    progress: { activity: activity(), startedAt },
    childId: taskId,
    ...(currentTool === undefined ? {} : { currentTool }),
    ...(lastAssistantLine === undefined ? {} : { lastAssistantLine }),
    turns,
    ...(tokens === undefined ? {} : { tokens }),
  })

  return {
    accept(event): boolean {
      if (event.type === "tool_execution_start" && typeof event.toolName === "string") {
        currentTool = toolLabel(event.toolName, event.args ?? event.input)
        return true
      }
      if (event.type === "tool_execution_end") {
        if (currentTool === undefined) return false
        currentTool = undefined
        return true
      }
      if (event.type !== "message_end") return false
      const text = assistantText(event.message)
      if (text === undefined) return false
      turns += 1
      lastAssistantLine = truncate(lastNonEmptyLine(text), 120)
      tokens = readTokens(event.message) ?? tokens
      return true
    },
    details,
    text(now): string {
      const elapsed = Math.max(0, Math.floor((now - startedAt) / 1_000))
      const target = category === undefined ? taskId : `${taskId} · ${category}`
      const line = `⏵ ${target} · turn ${turns} · ${activity()} · ${elapsed}s`
      return lastAssistantLine === undefined ? line : `${line}\n↳ last: ${lastAssistantLine}`
    },
  }
}

export function readToolProgressDetails(value: unknown): ToolProgressDetails | undefined {
  if (!isRecord(value) || !isRecord(value.progress)) return undefined
  if (typeof value.progress.activity !== "string" || typeof value.progress.startedAt !== "number") return undefined
  if (typeof value.childId !== "string" || typeof value.turns !== "number") return undefined
  if (value.currentTool !== undefined && typeof value.currentTool !== "string") return undefined
  if (value.lastAssistantLine !== undefined && typeof value.lastAssistantLine !== "string") return undefined
  if (value.tokens !== undefined && typeof value.tokens !== "number") return undefined
  return value as ToolProgressDetails
}

function toolLabel(toolName: string, args: unknown): string {
  const argument = oneLineArgument(args)
  return argument.length === 0 ? toolName : `${toolName} ${argument}`
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
