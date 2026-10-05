// Bounded event stream for the resident Kibitzer sidecar.
//
// Every parent hook (prompt, tool_call, tool_result) becomes one KibitzerEvent carrying the parent
// branch cursor; a newly finished assistant message on the branch is emitted ahead of the hook that
// revealed it. Bodies are redacted BEFORE they are truncated and BEFORE they are stored, so a cut
// can never expose the tail of a secret the pattern would have caught whole. The stream keeps the
// newest 20 events verbatim and folds everything older into a one-line digest that always names
// the first and last folded cursor.
//
// Payload readers live in `events-payload`, the redaction / truncation / digest text in
// `events-text`; this module is the stream, the rendered fragment and the public surface.

import type { ComponentLogger } from "../../../extension/types"
import { newestAssistant, promptText, toolArgsText, toolCallOf, toolResultOf } from "./events-payload"
import { DIGEST_TAIL_FRAGMENTS, digestLine, escapeXml, fragmentOf, redactKibitzerEventText, truncateHead, type FoldState } from "./events-text"

export { KIBITZER_DIGEST_MAX_CHARS, redactKibitzerEventText } from "./events-text"

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

type PendingEvent = Omit<KibitzerEvent, "seq" | "at">

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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
