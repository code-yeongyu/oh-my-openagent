import { isRecord } from "./error-classifier"

const RESULT_PART_TYPES = new Set(["tool", "tool_use", "tool_result"])

export interface OutputLimitStop {
  readonly messageID?: string
  readonly outputTokens?: number
  /** The capped turn still delivered text or a tool call. Reasoning alone is not a result. */
  readonly hasResult: boolean
}

function readOutputTokenCount(tokens: unknown): number | undefined {
  if (!isRecord(tokens)) return undefined
  const output = tokens.output
  if (typeof output !== "number" || !Number.isFinite(output) || output <= 0) return undefined
  return output
}

function readParts(message: Record<string, unknown>): readonly unknown[] {
  return Array.isArray(message.parts) ? message.parts : []
}

function stoppedOnOutputLimit(info: Record<string, unknown>, parts: readonly unknown[]): boolean {
  const finish = info.finish
  if (finish === "length") return true
  if (typeof finish === "string" && finish.length > 0) return false

  let lastReason: unknown
  for (const part of parts) {
    if (!isRecord(part) || part.type !== "step-finish") continue
    lastReason = part.reason
  }
  return lastReason === "length"
}

function finalTurnHasResult(parts: readonly unknown[]): boolean {
  for (const part of parts) {
    if (!isRecord(part)) continue
    const type = part.type
    if (type === "text" && typeof part.text === "string" && part.text.trim().length > 0) return true
    if (typeof type === "string" && RESULT_PART_TYPES.has(type)) return true
  }
  return false
}

function readFinalOutputTokens(info: Record<string, unknown>, parts: readonly unknown[]): number | undefined {
  const fromInfo = readOutputTokenCount(info.tokens)
  if (fromInfo !== undefined) return fromInfo

  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (!isRecord(part) || part.type !== "step-finish") continue
    return readOutputTokenCount(part.tokens)
  }
  return undefined
}

function readMessageID(info: Record<string, unknown>): string | undefined {
  return typeof info.id === "string" && info.id.length > 0 ? info.id : undefined
}

function latestAssistantInfo(messages: readonly unknown[]): { info: Record<string, unknown>; parts: readonly unknown[] } | undefined {
  const latest = messages[messages.length - 1]
  if (!isRecord(latest)) return undefined
  const info = isRecord(latest.info) ? latest.info : undefined
  if (!info || info.role !== "assistant") return undefined
  return { info, parts: readParts(latest) }
}

/** Reads whether the latest message is an assistant turn that stopped on the output-token cap. */
export function getOutputLimitStop(messages: readonly unknown[]): OutputLimitStop | undefined {
  const latest = latestAssistantInfo(messages)
  if (!latest) return undefined
  if (!stoppedOnOutputLimit(latest.info, latest.parts)) return undefined

  return {
    messageID: readMessageID(latest.info),
    outputTokens: readFinalOutputTokens(latest.info, latest.parts),
    hasResult: finalTurnHasResult(latest.parts),
  }
}

/** The latest message when it is an assistant turn, else undefined: the turn a completion decides on. */
export function getLatestAssistantTurn(messages: readonly unknown[]): AssistantTurnFinish | undefined {
  const latest = latestAssistantInfo(messages)
  if (!latest) return undefined
  return {
    messageID: readMessageID(latest.info),
    stoppedOnLength: stoppedOnOutputLimit(latest.info, latest.parts),
  }
}

function tokenText(stop: OutputLimitStop): string {
  return stop.outputTokens === undefined ? "" : ` (${stop.outputTokens} tokens)`
}

export function formatOutputLimitError(stop: OutputLimitStop): string {
  return `stopped at output limit${tokenText(stop)}, no result`
}

export function formatOutputLimitNote(stop: OutputLimitStop): string {
  return `output was cut at the output limit${tokenText(stop)}`
}

export interface AssistantTurnFinish {
  readonly messageID?: string
  readonly stoppedOnLength: boolean
}

/**
 * Remembers, per child session, whether the latest assistant turn stopped on the output-token cap,
 * from `message.updated` events (and from message lists the manager already fetched). Completion
 * only fetches the message list when this says the latest turn hit the cap; a newer assistant turn
 * (a resume or steer) replaces the entry, so an old stop never decides a later completion.
 */
export class AssistantTurnFinishTracker {
  private readonly bySession = new Map<string, AssistantTurnFinish>()

  recordMessageUpdated(sessionID: string, info: Record<string, unknown>): void {
    const messageID = readMessageID(info)
    const finish = typeof info.finish === "string" && info.finish.length > 0 ? info.finish : undefined
    const previous = this.bySession.get(sessionID)
    if (finish === undefined && previous && previous.messageID === messageID) return
    this.bySession.set(sessionID, { messageID, stoppedOnLength: finish === "length" })
  }

  recordTurn(sessionID: string, turn: AssistantTurnFinish | undefined): void {
    if (!turn) return
    this.bySession.set(sessionID, turn)
  }

  get(sessionID: string): AssistantTurnFinish | undefined {
    return this.bySession.get(sessionID)
  }

  clear(sessionID: string): void {
    this.bySession.delete(sessionID)
  }
}
