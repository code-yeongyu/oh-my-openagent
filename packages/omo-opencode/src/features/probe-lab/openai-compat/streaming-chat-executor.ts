import { randomUUID } from "node:crypto"
import { log } from "../../../shared/logger"
import type {
  ProbeProvider,
  ProviderCredentials,
} from "../providers/provider-types"
import { uploadDeepSeekImage } from "./deepseek-file-upload"
import { parseSseStream } from "./deepseek-sse-reader"
import {
  dispatchStreamingCompletion,
  type StreamingDispatchInput,
} from "./deepseek-streaming-dispatch"
import { buildErrorResponse, invalidRequest } from "./errors"
import { translateMessages, type ImageUploader } from "./messages-translator"
import { resolveCapabilities } from "./model-capability-resolver"
import { buildOpenAIStream } from "./openai-sse-writer"
import { buildOpenAIToolStream } from "./openai-sse-tool-writer"
import { extractPassThroughFields } from "./passthrough-fields"
import type { ChatCompletionRequest } from "./schemas"
import { enqueueSessionDelete } from "./session-cleanup"
import { createChatSession } from "./session-factory"
import { classifyVerdict, getGlobalTelemetry, type Telemetry } from "./telemetry"
import { buildToolCallsInstructionBlock } from "./tool-calls/prompt"

export type StreamingExecutorInput = {
  provider: ProbeProvider
  baseUrl: string
  creds: ProviderCredentials
  body: ChatCompletionRequest
  requestId: string
  accountId?: string
  dispatcher?: typeof dispatchStreamingCompletion
  sessionFactory?: typeof createChatSession
  fetchChallenge?: StreamingDispatchInput["fetchChallenge"]
  fetchImpl?: StreamingDispatchInput["fetchImpl"]
  signal?: AbortSignal
  telemetry?: Telemetry
  enqueueDelete?: typeof enqueueSessionDelete
}

export async function executeChatCompletionStream(
  input: StreamingExecutorInput,
): Promise<Response> {
  const caps = resolveCapabilities(input.body.model, input.body)
  const uploader: ImageUploader = async ({ data, mimeType, filename }) =>
    uploadDeepSeekImage({
      provider: input.provider,
      baseUrl: input.baseUrl,
      imageData: data,
      mimeType,
      filename,
      requestId: input.requestId,
      visionModel: caps.modelType === "vision",
    })
  const tr = await translateMessages(input.body.messages, uploader, input.requestId)
  if (!tr.ok) return invalidRequest(tr.reason)

  const sessionFactory = input.sessionFactory ?? createChatSession
  const sess = await sessionFactory({
    provider: input.provider,
    baseUrl: input.baseUrl,
    requestId: input.requestId,
  })
  if (!sess.ok) {
    log(
      `openai-compat-stream: chat_session create failed [rid=${input.requestId}] reason=${sess.reason}`,
    )
    return buildErrorResponse(
      502,
      "internal_error",
      `chat_session create failed: ${sess.reason}`,
    )
  }

  const toolsActive =
    Array.isArray(input.body.tools) &&
    input.body.tools.length > 0 &&
    input.body.tool_choice !== "none"
  const parallelEnabled = input.body.parallel_tool_calls ?? true
  const finalPrompt = toolsActive
    ? `${buildToolCallsInstructionBlock(input.body.tools ?? [], input.body.tool_choice, parallelEnabled)}\n\n${tr.prompt}`
    : tr.prompt
  const passthrough = extractPassThroughFields(input.body)
  const requestBody = JSON.stringify({
    ...passthrough,
    chat_session_id: sess.id,
    parent_message_id: null,
    prompt: finalPrompt,
    ref_file_ids: tr.ref_file_ids,
    thinking_enabled: caps.thinkingEnabled,
    search_enabled: caps.searchEnabled,
    model_type: caps.modelType,
  })

  const t0 = Date.now()
  const upstreamAbort = new AbortController()
  if (input.signal) {
    if (input.signal.aborted) upstreamAbort.abort()
    else
      input.signal.addEventListener("abort", () => upstreamAbort.abort(), {
        once: true,
      })
  }
  const dispatcher = input.dispatcher ?? dispatchStreamingCompletion
  const dispatch = await dispatcher({
    baseUrl: input.baseUrl,
    creds: input.creds,
    requestBody,
    signal: upstreamAbort.signal,
    fetchChallenge: input.fetchChallenge,
    fetchImpl: input.fetchImpl,
  })

  const telemetry = input.telemetry ?? getGlobalTelemetry()
  const accountId = input.accountId ?? input.provider.id

  if (!dispatch.ok) {
    log(
      `openai-compat-stream: dispatch failed [rid=${input.requestId}] status=${dispatch.status} reason=${dispatch.reason}`,
    )
    const httpStatus = dispatch.status === 429 ? 429 : 502
    const errorType =
      dispatch.status === 429 ? "rate_limit_error" : "internal_error"
    telemetry.record({
      account_id: accountId,
      error_type: classifyVerdict({
        ok: false,
        status: dispatch.status,
        errorType,
        message: dispatch.reason,
      }),
      ts: Date.now(),
      request_id: input.requestId,
      status: dispatch.status,
    })
    return buildErrorResponse(
      httpStatus,
      errorType,
      `streaming dispatch failed: ${dispatch.reason}`,
    )
  }

  const responseId = `chatcmpl-${randomUUID()}`
  let bodyForParse = dispatch.body
  if (process.env.IDM_DEBUG_RAW_SSE === "1") {
    const [a, b] = dispatch.body.tee()
    bodyForParse = b
    void (async () => {
      try {
        const reader = a.getReader()
        const chunks: Uint8Array[] = []
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) chunks.push(value)
        }
        const total = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0))
        let off = 0
        for (const c of chunks) { total.set(c, off); off += c.length }
        await Bun.write(`/tmp/raw-sse-stream-${input.requestId}.txt`, total)
        log(`openai-compat-stream: raw SSE dumped to /tmp/raw-sse-stream-${input.requestId}.txt (${total.length} bytes)`)
      } catch {
        log(`openai-compat-stream: failed to dump raw SSE`)
      }
    })()
  }
  const events = parseSseStream(bodyForParse)
  const enqueueDelete = input.enqueueDelete ?? enqueueSessionDelete
  const onCompleteCommon = (info: { finished: boolean; finish_reason: string; content_chars: number; chunk_count: number }, label: string): void => {
    const elapsed = Date.now() - t0
    log(
      `openai-compat-stream: ${label} [rid=${input.requestId}] chunks=${info.chunk_count} content_chars=${info.content_chars} finish=${info.finish_reason} ms=${elapsed}`,
    )
    if (info.finished) {
      telemetry.record({
        account_id: accountId,
        error_type: "success",
        ts: Date.now(),
        request_id: input.requestId,
        status: 200,
      })
      enqueueDelete({
        provider: input.provider,
        baseUrl: input.baseUrl,
        chatSessionId: sess.id,
        requestId: input.requestId,
      })
    } else {
      telemetry.record({
        account_id: accountId,
        error_type: "truncated_stream",
        ts: Date.now(),
        request_id: input.requestId,
        status: 200,
      })
    }
  }
  const onCancelCommon = (): void => {
    upstreamAbort.abort()
    log(`openai-compat-stream: downstream cancel [rid=${input.requestId}]`)
  }
  const outStream = toolsActive
    ? buildOpenAIToolStream({
        events,
        body: input.body,
        responseId,
        onComplete: (info) => onCompleteCommon(info, "tool-stream-success"),
        onCancel: onCancelCommon,
      })
    : buildOpenAIStream({
        events,
        model: input.body.model,
        responseId,
        onComplete: (info) => onCompleteCommon(info, "success"),
        onCancel: onCancelCommon,
      })

  return new Response(outStream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
      "x-request-id": input.requestId,
    },
  })
}
