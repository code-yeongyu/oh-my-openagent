import type { SseEvent } from "./deepseek-sse-reader"
import { createFragmentTracker } from "./fragment-tracker"
import {
  buildOpenAIChunkLine,
  extractTerminalStatus,
  FINISHED_TERMINAL,
  safeParseFrame,
} from "./openai-sse-frame-helpers"
import type { ChatCompletionRequest } from "./schemas"
import {
  applyParallelToolCallsPolicy,
  applyToolChoicePolicy,
} from "./tool-calls/policy"
import {
  createStreamSieve,
  type SieveEvent,
} from "./tool-calls/stream-sieve"

export type ToolStreamCompletion = {
  content_chars: number
  reasoning_chars: number
  chunk_count: number
  tool_call_count: number
  finish_reason: string
  terminal_status: string | null
  finished: boolean
}

export type ToolStreamArgs = {
  events: AsyncIterable<SseEvent>
  body: ChatCompletionRequest
  responseId: string
  onComplete?: (info: ToolStreamCompletion) => void
  onCancel?: () => void
}

const ENC = new TextEncoder()

function resolveFinishReason(terminal: string | null, anyToolCall: boolean): string {
  if (anyToolCall) return "tool_calls"
  if (terminal === FINISHED_TERMINAL) return "stop"
  if (terminal === null) return "length"
  return "stop"
}

function shouldAcceptName(
  name: string,
  body: ChatCompletionRequest,
  acceptedSoFar: number,
): boolean {
  const parallelEnabled = body.parallel_tool_calls ?? true
  const candidate = { name, arguments: {} }
  const choiceFiltered = applyToolChoicePolicy([candidate], body.tool_choice)
  if (choiceFiltered.kept.length === 0) return false
  if (!parallelEnabled && acceptedSoFar >= 1) return false
  const cap = applyParallelToolCallsPolicy(choiceFiltered.kept, parallelEnabled)
  return cap.kept.length === 1
}

export function buildOpenAIToolStream(args: ToolStreamArgs): ReadableStream<Uint8Array> {
  const created = Math.floor(Date.now() / 1000)
  const id = args.responseId
  const model = args.body.model
  let chunkCount = 0
  let contentChars = 0
  let reasoningChars = 0
  let toolCallCount = 0
  let acceptedTools = 0
  let cancelled = false
  const acceptedByIndex = new Map<number, boolean>()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          ENC.encode(buildOpenAIChunkLine({ id, model, created, delta: { role: "assistant" }, finish_reason: null })),
        )
        chunkCount++
        const sieve = createStreamSieve()
        const tracker = createFragmentTracker()
        let terminal: string | null = null
        let currentPath = ""
        const emitReasoning = (text: string): void => {
          reasoningChars += text.length
          controller.enqueue(
            ENC.encode(buildOpenAIChunkLine({ id, model, created, delta: { reasoning_content: text }, finish_reason: null })),
          )
          chunkCount++
        }
        const emitToolStarted = (idx: number, callId: string, name: string): void => {
          if (!shouldAcceptName(name, args.body, acceptedTools)) {
            acceptedByIndex.set(idx, false)
            return
          }
          acceptedByIndex.set(idx, true)
          acceptedTools++
          controller.enqueue(
            ENC.encode(
              buildOpenAIChunkLine({
                id, model, created,
                delta: { tool_calls: [{ index: idx, id: callId, type: "function", function: { name } }] },
                finish_reason: null,
              }),
            ),
          )
          chunkCount++
        }
        const emitArgsDelta = (idx: number, delta: string): void => {
          if (acceptedByIndex.get(idx) !== true) return
          controller.enqueue(
            ENC.encode(
              buildOpenAIChunkLine({
                id, model, created,
                delta: { tool_calls: [{ index: idx, function: { arguments: delta } }] },
                finish_reason: null,
              }),
            ),
          )
          chunkCount++
        }
        const handleSieve = (e: SieveEvent): void => {
          if (e.type === "content" && e.text.length > 0) {
            contentChars += e.text.length
            controller.enqueue(
              ENC.encode(buildOpenAIChunkLine({ id, model, created, delta: { content: e.text }, finish_reason: null })),
            )
            chunkCount++
            return
          }
          if (e.type === "tool_call_started") {
            emitToolStarted(e.index, e.id, e.name)
            return
          }
          if (e.type === "tool_call_argument_delta") {
            emitArgsDelta(e.index, e.argumentsDelta)
            return
          }
          if (e.type === "tool_call_complete") {
            if (acceptedByIndex.get(e.index) === true) toolCallCount++
            return
          }
        }
        for await (const ev of args.events) {
          if (cancelled) break
          const trimmed = ev.data.trim()
          if (trimmed.length === 0 || trimmed === "[DONE]") continue
          const parsed = safeParseFrame(trimmed)
          if (!parsed) continue
          if (typeof parsed.p === "string") currentPath = parsed.p
          for (const fragEvt of tracker.feed(parsed, currentPath)) {
            if (!fragEvt) continue
            if (fragEvt.kind === "reasoning") {
              emitReasoning(fragEvt.text)
              continue
            }
            for (const e of sieve.feed(fragEvt.text)) handleSieve(e)
          }
          const status = extractTerminalStatus(parsed)
          if (status !== null) terminal = status
        }
        if (cancelled) return
        for (const e of sieve.end()) handleSieve(e)
        const finishReason = resolveFinishReason(terminal, toolCallCount > 0)
        controller.enqueue(
          ENC.encode(buildOpenAIChunkLine({ id, model, created, delta: {}, finish_reason: finishReason })),
        )
        chunkCount++
        controller.enqueue(ENC.encode("data: [DONE]\n\n"))
        controller.close()
        args.onComplete?.({
          content_chars: contentChars,
          reasoning_chars: reasoningChars,
          chunk_count: chunkCount,
          tool_call_count: toolCallCount,
          finish_reason: finishReason,
          terminal_status: terminal,
          finished: terminal === FINISHED_TERMINAL,
        })
      } catch (err) {
        if (cancelled) {
          try { controller.close() } catch { void 0 }
          return
        }
        const msg = err instanceof Error ? err.message : String(err)
        controller.enqueue(
          ENC.encode(`data: ${JSON.stringify({ error: { type: "internal_error", message: msg } })}\n\n`),
        )
        controller.enqueue(ENC.encode("data: [DONE]\n\n"))
        controller.close()
      }
    },
    cancel() {
      cancelled = true
      args.onCancel?.()
    },
  })
}
