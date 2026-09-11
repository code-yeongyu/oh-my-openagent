// Bounded event stream for the resident Kibitzer sidecar.
//
// Every parent hook (prompt, tool_call, tool_result) becomes one KibitzerEvent carrying the parent
// branch cursor; a newly finished assistant message on the branch is emitted ahead of the hook that
// revealed it. Bodies are redacted BEFORE they are truncated and BEFORE they are stored, so a cut
// can never expose the tail of a secret the pattern would have caught whole. The stream keeps the
// newest 20 events verbatim and folds everything older into a one-line digest that always names
// the first and last folded cursor.

import { redactUrl } from "@oh-my-opencode/memory-core"

import type { ComponentLogger } from "../../../extension/types"
import { EXCLUDED_CUSTOM_TYPES, textOf } from "../recall-session-read"
import { redactSensitiveOutput } from "./sensitive-output"

export type KibitzerEventKind = "prompt" | "assistant" | "tool_call" | "tool_result"

/** Character caps per event body; mirrors `memory.recall.event_caps`. */
export interface KibitzerEventCaps {
  readonly toolArgs: number
  readonly resultHead: number
  readonly assistant: number
  readonly prompt: number
}

export const DEFAULT_KIBITZER_EVENT_CAPS: KibitzerEventCaps = { toolArgs: 400, resultHead: 600, assistant: 1500, prompt: 4000 }
export const KIBITZER_EVENT_BUFFER_SIZE = 20
export const KIBITZER_DIGEST_MAX_CHARS = 1024

const DIGEST_TAIL_FRAGMENTS = 12
const DIGEST_FRAGMENT_CHARS = 72
const IDENTIFIER_MAX_CHARS = 64
const UNSERIALIZABLE_INPUT = "[unserializable tool input]"

export interface KibitzerEvent {
  /** Monotonic per stream lifetime; survives drains so wake envelopes never reuse a number. */
  readonly seq: number
  /** Parent branch position at capture: `sessionManager.getBranch().length`. */
  readonly cursor: number
  /** Epoch milliseconds from the stream clock. */
  readonly at: number
  readonly kind: KibitzerEventKind
  /** Redacted, then truncated to the kind's cap. */
  readonly body: string
  readonly truncated: boolean
  /** tool_call / tool_result only. */
  readonly tool?: string
  /** tool_call / tool_result only, when the host supplied a `toolCallId`. */
  readonly callId?: string
  /** tool_result only. */
  readonly isError?: boolean
}

export interface KibitzerEventDigest {
  readonly count: number
  readonly firstSeq: number
  readonly lastSeq: number
  readonly firstCursor: number
  readonly lastCursor: number
  /** One line, at most `KIBITZER_DIGEST_MAX_CHARS` characters after redaction and truncation. */
  readonly line: string
}

export interface KibitzerEventBatch {
  readonly events: readonly KibitzerEvent[]
  readonly digest?: KibitzerEventDigest
  /** Oldest folded (or buffered) cursor through the newest buffered one. */
  readonly cursors?: { readonly first: number; readonly last: number }
}

export interface KibitzerEventStreamOptions {
  readonly caps?: Partial<KibitzerEventCaps>
  readonly now?: () => number
  readonly logger?: Pick<ComponentLogger, "warn">
}

/**
 * One stream per main session. Capture methods take the raw hook payload plus the branch snapshot
 * the hook read synchronously (`sessionManager.getBranch()`); they return whether an event was
 * recorded and never throw into the parent hook.
 */
export interface KibitzerEventStream {
  onPrompt(payload: unknown, branch: unknown): boolean
  onToolCall(payload: unknown, branch: unknown): boolean
  onToolResult(payload: unknown, branch: unknown): boolean
  /** Buffered (unfolded) events, at most `KIBITZER_EVENT_BUFFER_SIZE`. */
  size(): number
  /** Cursor of the newest recorded event across drains; the seed for `session_entries(since)`. */
  lastCursor(): number | undefined
  peek(): KibitzerEventBatch
  /** Returns the pending batch and starts a new one; `seq` and `lastCursor` keep counting. */
  drain(): KibitzerEventBatch
}

interface FoldState {
  count: number
  firstSeq: number
  lastSeq: number
  firstCursor: number
  lastCursor: number
  /** Fragment of the first folded event: the task's origin usually lives there. */
  readonly head: string
  /** Newest folded fragments after the head, oldest first, bounded. */
  readonly tail: string[]
}

type PendingEvent = Omit<KibitzerEvent, "seq" | "at">

/** memory-core credential/secret masks first, then the senpi `core/sensitive-output` patterns. */
export function redactKibitzerEventText(text: string): string {
  return redactSensitiveOutput(redactUrl(text))
}

export function createKibitzerEventStream(options: KibitzerEventStreamOptions = {}): KibitzerEventStream {
  const caps: KibitzerEventCaps = {
    toolArgs: options.caps?.toolArgs ?? DEFAULT_KIBITZER_EVENT_CAPS.toolArgs,
    resultHead: options.caps?.resultHead ?? DEFAULT_KIBITZER_EVENT_CAPS.resultHead,
    assistant: options.caps?.assistant ?? DEFAULT_KIBITZER_EVENT_CAPS.assistant,
    prompt: options.caps?.prompt ?? DEFAULT_KIBITZER_EVENT_CAPS.prompt,
  }
  const now = options.now ?? Date.now
  const events: KibitzerEvent[] = []
  let fold: FoldState | undefined
  let seq = 0
  let latestCursor: number | undefined
  let branchLength = 0
  let assistantIndex = -1

  function guarded(kind: KibitzerEventKind, capture: () => boolean): boolean {
    try {
      return capture()
    } catch (error: unknown) {
      options.logger?.warn("omo-senpi kibitzer event capture skipped", { kind, error: describe(error) })
      return false
    }
  }

  function bounded(text: string, cap: number): { readonly body: string; readonly truncated: boolean } {
    const clean = redactKibitzerEventText(text)
    if (clean.length <= cap) return { body: clean, truncated: false }
    return { body: truncateHead(clean, cap), truncated: true }
  }

  function push(pending: PendingEvent): void {
    seq += 1
    const event: KibitzerEvent = { seq, at: now(), ...pending }
    latestCursor = event.cursor
    events.push(event)
    if (events.length <= KIBITZER_EVENT_BUFFER_SIZE) return
    const oldest = events.shift()
    if (oldest !== undefined) foldInto(oldest)
  }

  function foldInto(event: KibitzerEvent): void {
    const fragment = fragmentOf(event)
    if (fold === undefined) {
      fold = { count: 1, firstSeq: event.seq, lastSeq: event.seq, firstCursor: event.cursor, lastCursor: event.cursor, head: fragment, tail: [] }
      return
    }
    fold.count += 1
    fold.lastSeq = event.seq
    fold.lastCursor = event.cursor
    fold.tail.push(fragment)
    if (fold.tail.length > DIGEST_TAIL_FRAGMENTS) fold.tail.shift()
  }

  /**
   * Records the branch position and emits the newest assistant text once. A shorter branch than
   * last time means the parent switched or forked, so assistant positions start over.
   */
  function observe(branch: unknown): number {
    if (!Array.isArray(branch)) return latestCursor ?? 0
    if (branch.length < branchLength) assistantIndex = -1
    branchLength = branch.length
    const cursor = branch.length
    const newest = newestAssistant(branch)
    if (newest !== undefined && newest.index > assistantIndex) {
      assistantIndex = newest.index
      if (newest.text.length > 0) push({ kind: "assistant", cursor, ...bounded(newest.text, caps.assistant) })
    }
    return cursor
  }

  function batch(): KibitzerEventBatch {
    const digest: KibitzerEventDigest | undefined = fold === undefined ? undefined : {
      count: fold.count,
      firstSeq: fold.firstSeq,
      lastSeq: fold.lastSeq,
      firstCursor: fold.firstCursor,
      lastCursor: fold.lastCursor,
      line: digestLine(fold),
    }
    const first = digest?.firstCursor ?? events[0]?.cursor
    const last = events.at(-1)?.cursor ?? digest?.lastCursor
    return {
      events: [...events],
      ...(digest === undefined ? {} : { digest }),
      ...(first === undefined || last === undefined ? {} : { cursors: { first, last } }),
    }
  }

  return {
    onPrompt(payload, branch): boolean {
      return guarded("prompt", () => {
        const text = promptText(payload)
        if (text === undefined) return false
        const cursor = observe(branch)
        push({ kind: "prompt", cursor, ...bounded(text, caps.prompt) })
        return true
      })
    },
    onToolCall(payload, branch): boolean {
      return guarded("tool_call", () => {
        const call = toolCallOf(payload)
        if (call === undefined) return false
        const cursor = observe(branch)
        push({
          kind: "tool_call",
          cursor,
          tool: call.tool,
          ...(call.callId === undefined ? {} : { callId: call.callId }),
          ...bounded(toolArgsText(call.tool, call.input), caps.toolArgs),
        })
        return true
      })
    },
    onToolResult(payload, branch): boolean {
      return guarded("tool_result", () => {
        const result = toolResultOf(payload)
        if (result === undefined) return false
        const cursor = observe(branch)
        push({
          kind: "tool_result",
          cursor,
          tool: result.tool,
          ...(result.callId === undefined ? {} : { callId: result.callId }),
          isError: result.isError,
          ...bounded(result.text, caps.resultHead),
        })
        return true
      })
    },
    size: () => events.length,
    lastCursor: () => latestCursor,
    peek: batch,
    drain(): KibitzerEventBatch {
      const pending = batch()
      events.length = 0
      fold = undefined
      return pending
    },
  }
}

/** XML-ish fragment for a wake envelope: one `<digest>` line, then one `<event>` per buffered event. */
export function renderKibitzerEventBatch(batch: KibitzerEventBatch): string {
  const lines: string[] = []
  if (batch.digest !== undefined) {
    lines.push(`<digest folded="${batch.digest.count}" cursor="${batch.digest.firstCursor}..${batch.digest.lastCursor}">${escapeXml(batch.digest.line)}</digest>`)
  }
  for (const event of batch.events) lines.push(renderEvent(event))
  return lines.join("\n")
}

function renderEvent(event: KibitzerEvent): string {
  const attributes = [`seq="${event.seq}"`, `cursor="${event.cursor}"`, `kind="${event.kind}"`]
  if (event.tool !== undefined) attributes.push(`tool="${escapeXml(event.tool)}"`)
  if (event.callId !== undefined) attributes.push(`call="${escapeXml(event.callId)}"`)
  if (event.isError !== undefined) attributes.push(`error="${event.isError}"`)
  if (event.truncated) attributes.push('truncated="true"')
  return `<event ${attributes.join(" ")}>${escapeXml(event.body)}</event>`
}

function promptText(payload: unknown): string | undefined {
  const text = typeof payload === "string" ? payload : isRecord(payload) && typeof payload.prompt === "string" ? payload.prompt : undefined
  if (text === undefined) return undefined
  const trimmed = text.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function toolCallOf(payload: unknown): { readonly tool: string; readonly callId?: string; readonly input: Record<string, unknown> } | undefined {
  if (!isRecord(payload) || typeof payload.toolName !== "string" || !isRecord(payload.input)) return undefined
  const callId = identifier(payload.toolCallId)
  return { tool: identifier(payload.toolName) ?? payload.toolName, ...(callId === undefined ? {} : { callId }), input: payload.input }
}

function toolResultOf(payload: unknown): { readonly tool: string; readonly callId?: string; readonly text: string; readonly isError: boolean } | undefined {
  if (!isRecord(payload) || typeof payload.toolName !== "string") return undefined
  const callId = identifier(payload.toolCallId)
  return {
    tool: identifier(payload.toolName) ?? payload.toolName,
    ...(callId === undefined ? {} : { callId }),
    text: resultText(payload.content),
    isError: payload.isError === true,
  }
}

/** `eval.summary` when present, otherwise the code head; every other tool gets its compact JSON input. */
function toolArgsText(tool: string, input: Record<string, unknown>): string {
  if (tool === "eval") {
    if (typeof input.summary === "string" && input.summary.trim().length > 0) return input.summary.trim()
    if (typeof input.code === "string") return input.code
  }
  try {
    return JSON.stringify(input) ?? UNSERIALIZABLE_INPUT
  } catch {
    return UNSERIALIZABLE_INPUT
  }
}

function resultText(content: unknown): string {
  const text = textOf(content).trim()
  if (text.length > 0 || !Array.isArray(content)) return text
  const images = content.filter((block) => isRecord(block) && block.type === "image").length
  return images === 0 ? "" : `[${images} image${images === 1 ? "" : "s"}]`
}

function newestAssistant(branch: readonly unknown[]): { readonly index: number; readonly text: string } | undefined {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index]
    if (!isRecord(entry) || entry.type !== "message") continue
    const message = entry.message
    if (!isRecord(message) || message.role !== "assistant") continue
    if (typeof message.customType === "string" && EXCLUDED_CUSTOM_TYPES.has(message.customType)) continue
    return { index, text: textOf(message.content).trim() }
  }
  return undefined
}

/**
 * Head truncation to exactly `cap` characters with a trailing marker for the characters beyond the
 * cap; the marker itself displaces a few more. A cap too small for the marker is a plain cut.
 */
function truncateHead(text: string, cap: number): string {
  const marker = ` [+${text.length - cap} chars]`
  if (cap <= marker.length) return withoutDanglingSurrogate(text.slice(0, cap))
  return `${withoutDanglingSurrogate(text.slice(0, cap - marker.length))}${marker}`
}

function withoutDanglingSurrogate(text: string): string {
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text
}

function fragmentOf(event: KibitzerEvent): string {
  const label = event.tool === undefined ? event.kind : `${event.kind}(${event.tool})`
  const status = event.isError === true ? " error" : ""
  const body = event.body.replace(/\s+/g, " ").trim()
  const clipped = body.length > DIGEST_FRAGMENT_CHARS ? `${body.slice(0, DIGEST_FRAGMENT_CHARS)}...` : body
  return `${label}${status} "${clipped}"`
}

/**
 * Header (count, seq range, cursor range) plus the head fragment, an elision marker, and as many of
 * the newest tail fragments as fit. Redacted again after composition, then hard-capped from the tail
 * so the header - and with it both cursors - always survives.
 */
function digestLine(fold: FoldState): string {
  const header = `${fold.count} earlier events folded (seq ${fold.firstSeq}-${fold.lastSeq}, cursor ${fold.firstCursor}..${fold.lastCursor}): `
  const budget = Math.max(0, KIBITZER_DIGEST_MAX_CHARS - header.length)
  let tail = [...fold.tail]
  let elided = fold.count - 1 - tail.length
  let body = joinFragments(fold.head, elided, tail)
  while (body.length > budget && tail.length > 0) {
    tail = tail.slice(1)
    elided += 1
    body = joinFragments(fold.head, elided, tail)
  }
  const line = redactKibitzerEventText(`${header}${body}`).replace(/[\r\n]+/g, " ")
  return line.length <= KIBITZER_DIGEST_MAX_CHARS ? line : line.slice(0, KIBITZER_DIGEST_MAX_CHARS)
}

function joinFragments(head: string, elided: number, tail: readonly string[]): string {
  return [head, ...(elided > 0 ? [`... ${elided} more ...`] : []), ...tail].join(" | ")
}

function identifier(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined
  return value.length > IDENTIFIER_MAX_CHARS ? value.slice(0, IDENTIFIER_MAX_CHARS) : value
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"]/g, (character) => XML_ESCAPES[character] ?? character)
}

const XML_ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
