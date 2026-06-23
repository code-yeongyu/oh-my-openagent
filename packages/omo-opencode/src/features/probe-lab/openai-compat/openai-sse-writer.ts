import type { SseEvent } from "./deepseek-sse-reader"
import { createFragmentTracker, type FragmentEvent } from "./fragment-tracker"
import {
  buildOpenAIChunkLine as buildChunkLine,
  extractTerminalStatus,
  FINISHED_TERMINAL,
  safeParseFrame,
} from "./openai-sse-frame-helpers"

export type OpenAIStreamCompletion = {
  content_chars: number
  reasoning_chars: number
  chunk_count: number
  finish_reason: string
  terminal_status: string | null
  finished: boolean
}

export type OpenAIStreamArgs = {
  events: AsyncIterable<SseEvent>
  model: string
  responseId: string
  onComplete?: (info: OpenAIStreamCompletion) => void
  onCancel?: () => void
}

const ENC = new TextEncoder()

function resolveFinishReason(terminal: string | null): string {
  if (terminal === FINISHED_TERMINAL) return "stop"
  if (terminal === null) return "length"
  return "stop"
}

function deltaForEvent(
  ev: FragmentEvent,
): { delta: Record<string, unknown>; reasoning: number; content: number } | null {
  if (!ev) return null
  if (ev.kind === "reasoning") {
    return {
      delta: { reasoning_content: ev.text },
      reasoning: ev.text.length,
      content: 0,
    }
  }
  return {
    delta: { content: ev.text },
    reasoning: 0,
    content: ev.text.length,
  }
}

export function buildOpenAIStream(
  args: OpenAIStreamArgs,
): ReadableStream<Uint8Array> {
  const created = Math.floor(Date.now() / 1000)
  const id = args.responseId
  const model = args.model
  let chunkCount = 0
  let contentChars = 0
  let reasoningChars = 0

  let cancelled = false

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(
          ENC.encode(
            buildChunkLine({
              id,
              model,
              created,
              delta: { role: "assistant" },
              finish_reason: null,
            }),
          ),
        )
        chunkCount++
        const tracker = createFragmentTracker()
        let terminal: string | null = null
        let currentPath = ""
        for await (const ev of args.events) {
          if (cancelled) break
          const trimmed = ev.data.trim()
          if (trimmed.length === 0 || trimmed === "[DONE]") continue
          const parsed = safeParseFrame(trimmed)
          if (!parsed) continue
          if (typeof parsed.p === "string") currentPath = parsed.p
          for (const fragEvt of tracker.feed(parsed, currentPath)) {
            const out = deltaForEvent(fragEvt)
            if (!out) continue
            contentChars += out.content
            reasoningChars += out.reasoning
            controller.enqueue(
              ENC.encode(
                buildChunkLine({
                  id,
                  model,
                  created,
                  delta: out.delta,
                  finish_reason: null,
                }),
              ),
            )
            chunkCount++
          }
          const status = extractTerminalStatus(parsed)
          if (status !== null) terminal = status
        }
        if (cancelled) return
        const finishReason = resolveFinishReason(terminal)
        controller.enqueue(
          ENC.encode(
            buildChunkLine({
              id,
              model,
              created,
              delta: {},
              finish_reason: finishReason,
            }),
          ),
        )
        chunkCount++
        controller.enqueue(ENC.encode("data: [DONE]\n\n"))
        controller.close()
        args.onComplete?.({
          content_chars: contentChars,
          reasoning_chars: reasoningChars,
          chunk_count: chunkCount,
          finish_reason: finishReason,
          terminal_status: terminal,
          finished: terminal === FINISHED_TERMINAL,
        })
      } catch (err) {
        if (cancelled) {
          try {
            controller.close()
          } catch {
            void 0
          }
          return
        }
        const msg = err instanceof Error ? err.message : String(err)
        controller.enqueue(
          ENC.encode(
            `data: ${JSON.stringify({ error: { type: "internal_error", message: msg } })}\n\n`,
          ),
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
