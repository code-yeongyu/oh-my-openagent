import { log } from "../../../shared/logger"
import type {
  ProbeProvider,
  ProbeRequest,
  ProbeResponse,
} from "../providers/provider-types"
import { uploadDeepSeekImage } from "./deepseek-file-upload"
import { classifyDeepSeekResponse } from "./deepseek-response-classifier"
import { raceWithTimeout } from "./dispatch-timeout-race"
import type { OpenAIErrorType } from "./errors"
import { resolveCapabilities } from "./model-capability-resolver"
import { buildOpenAIResponse } from "./openai-response-builder"
import { translateMessages, type ImageUploader } from "./messages-translator"
import { extractPassThroughFields } from "./passthrough-fields"
import { enqueueSessionDelete } from "./session-cleanup"
import { createChatSession } from "./session-factory"
import type { ChatCompletionRequest, ChatCompletionResponse } from "./schemas"
import { classifyVerdict, getGlobalTelemetry, type Telemetry } from "./telemetry"
import { buildToolCallsInstructionBlock } from "./tool-calls/prompt"
import { selectToolAwareResponse } from "./tool-calls/select-response"

const COMPLETION_PATH = "/api/v0/chat/completion"
const COMPLETION_TIMEOUT_MS = 120_000

export type ChatExecutorInput = {
  provider: ProbeProvider
  baseUrl: string
  body: ChatCompletionRequest
  requestId: string
  accountId?: string
  telemetry?: Telemetry
  enqueueDelete?: typeof enqueueSessionDelete
  dispatchTimeoutMs?: number
}

export type ChatExecutorOutput =
  | { ok: true; response: ChatCompletionResponse }
  | { ok: false; httpStatus: number; errorType: OpenAIErrorType; message: string }

export async function executeChatCompletion(
  input: ChatExecutorInput,
): Promise<ChatExecutorOutput> {
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
  if (!tr.ok) {
    return {
      ok: false,
      httpStatus: 400,
      errorType: "invalid_request_error",
      message: tr.reason,
    }
  }

  const sess = await createChatSession({
    provider: input.provider,
    baseUrl: input.baseUrl,
    requestId: input.requestId,
  })
  if (!sess.ok) {
    log(
      `openai-compat-executor: chat_session create failed [rid=${input.requestId}] reason=${sess.reason}`,
    )
    return {
      ok: false,
      httpStatus: 502,
      errorType: "internal_error",
      message: `chat_session create failed: ${sess.reason}`,
    }
  }

  const url = `${input.baseUrl.replace(/\/$/, "")}${COMPLETION_PATH}`
  const toolsActive =
    Array.isArray(input.body.tools) &&
    input.body.tools.length > 0 &&
    input.body.tool_choice !== "none"
  const parallelEnabled = input.body.parallel_tool_calls ?? true
  const finalPrompt = toolsActive
    ? `${buildToolCallsInstructionBlock(input.body.tools ?? [], input.body.tool_choice, parallelEnabled)}\n\n${tr.prompt}`
    : tr.prompt
  const dispatchTimeoutMs = input.dispatchTimeoutMs ?? COMPLETION_TIMEOUT_MS
  const passthrough = extractPassThroughFields(input.body)
  const buildProbeReq = (
    parentMessageId: number | null,
    exchangeSequence: number,
  ): ProbeRequest => ({
    url,
    method: "POST",
      headers: {},
    body: JSON.stringify({
      ...passthrough,
      chat_session_id: sess.id,
      parent_message_id: parentMessageId,
      prompt: finalPrompt,
      ref_file_ids: tr.ref_file_ids,
      model_type: caps.modelType,
      thinking_enabled: caps.thinkingEnabled,
      search_enabled: caps.searchEnabled,
    }),
    timeout_ms: dispatchTimeoutMs,
    forward_as_is: false,
    metadata: { session_id: `oai-${input.requestId}`, exchange_sequence: exchangeSequence },
  })
  const t0 = Date.now()
  const telemetry = input.telemetry ?? getGlobalTelemetry()
  const accountId = input.accountId ?? input.provider.id
  let res: ProbeResponse
  try {
    res = await raceWithTimeout(
      input.provider.dispatchProbe(buildProbeReq(null, 1)),
      dispatchTimeoutMs,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const elapsed = Date.now() - t0
    log(
      `openai-compat-executor: dispatch threw [rid=${input.requestId}] ms=${elapsed} reason=${msg}`,
    )
    telemetry.record({
      account_id: accountId,
      error_type: classifyVerdict({
        ok: false,
        errorType: "internal_error",
        message: msg,
      }),
      ts: Date.now(),
      request_id: input.requestId,
    })
    return {
      ok: false,
      httpStatus: 502,
      errorType: "internal_error",
      message: `dispatch failed: ${msg}`,
    }
  }
  let elapsedMs = Date.now() - t0

  let verdict = classifyDeepSeekResponse(res)
  if (!verdict.ok) {
    if (process.env.IDM_DEBUG_RAW_SSE === "1") {
      const dumpPath = `/tmp/raw-sse-${input.requestId}.txt`
      try {
        await Bun.write(dumpPath, res.body ?? "")
        log(`openai-compat-executor: raw SSE dumped to ${dumpPath} (${(res.body ?? "").length} bytes)`)
      } catch {
        log(`openai-compat-executor: failed to dump raw SSE`)
      }
    }
    log(
      `openai-compat-executor: failure [rid=${input.requestId}] type=${verdict.errorType} status=${res.status} ms=${elapsedMs} reason=${verdict.message}`,
    )
    telemetry.record({
      account_id: accountId,
      error_type: classifyVerdict({
        ok: false,
        status: res.status,
        errorType: verdict.errorType,
        message: verdict.message,
      }),
      ts: Date.now(),
      request_id: input.requestId,
      status: res.status,
    })
    return verdict
  }
  if (
    toolsActive &&
    verdict.content.length === 0 &&
    verdict.responseMessageId === null
  ) {
    log(
      `openai-compat-executor: empty output with tools active [rid=${input.requestId}] but response_message_id missing → skipping retry`,
    )
    telemetry.record({
      account_id: accountId,
      error_type: "empty_output_after_retry",
      ts: Date.now(),
      request_id: input.requestId,
      status: 200,
    })
    const enqueueDelete = input.enqueueDelete ?? enqueueSessionDelete
    enqueueDelete({
      provider: input.provider,
      baseUrl: input.baseUrl,
      chatSessionId: sess.id,
      requestId: input.requestId,
    })
    return {
      ok: true,
      response: buildOpenAIResponse({
        content: "",
        model: input.body.model,
        reasoning_content: verdict.reasoningText,
      }),
    }
  }
  if (toolsActive && verdict.content.length === 0) {
    log(
      `openai-compat-executor: empty output with tools active [rid=${input.requestId}] retrying once`,
    )
    try {
      res = await raceWithTimeout(
        input.provider.dispatchProbe(
          buildProbeReq(verdict.responseMessageId, 2),
        ),
        dispatchTimeoutMs,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      elapsedMs = Date.now() - t0
      log(
        `openai-compat-executor: retry dispatch threw [rid=${input.requestId}] ms=${elapsedMs} reason=${msg}`,
      )
      telemetry.record({
        account_id: accountId,
        error_type: classifyVerdict({
          ok: false,
          errorType: "internal_error",
          message: msg,
        }),
        ts: Date.now(),
        request_id: input.requestId,
      })
      return {
        ok: false,
        httpStatus: 502,
        errorType: "internal_error",
        message: `retry dispatch failed: ${msg}`,
      }
    }
    elapsedMs = Date.now() - t0
    verdict = classifyDeepSeekResponse(res)
    if (!verdict.ok) {
      log(
        `openai-compat-executor: failure after retry [rid=${input.requestId}] type=${verdict.errorType} status=${res.status} ms=${elapsedMs} reason=${verdict.message}`,
      )
      telemetry.record({
        account_id: accountId,
        error_type: classifyVerdict({
          ok: false,
          status: res.status,
          errorType: verdict.errorType,
          message: verdict.message,
        }),
        ts: Date.now(),
        request_id: input.requestId,
        status: res.status,
      })
      return verdict
    }
    if (verdict.content.length === 0) {
      log(
        `openai-compat-executor: empty output after retry [rid=${input.requestId}] content_chars=0`,
      )
      telemetry.record({
        account_id: accountId,
        error_type: "empty_output_after_retry",
        ts: Date.now(),
        request_id: input.requestId,
        status: 200,
      })
      const enqueueDelete = input.enqueueDelete ?? enqueueSessionDelete
      enqueueDelete({
        provider: input.provider,
        baseUrl: input.baseUrl,
        chatSessionId: sess.id,
        requestId: input.requestId,
      })
      return {
        ok: true,
        response: buildOpenAIResponse({
          content: "",
          model: input.body.model,
          reasoning_content: verdict.reasoningText,
        }),
      }
    }
  }
  elapsedMs = Date.now() - t0
  log(
    `openai-compat-executor: success [rid=${input.requestId}] content_chars=${verdict.content.length} ms=${elapsedMs}`,
  )
  telemetry.record({
    account_id: accountId,
    error_type: "success",
    ts: Date.now(),
    request_id: input.requestId,
    status: 200,
  })
  const enqueueDelete = input.enqueueDelete ?? enqueueSessionDelete
  enqueueDelete({
    provider: input.provider,
    baseUrl: input.baseUrl,
    chatSessionId: sess.id,
    requestId: input.requestId,
  })
  return selectToolAwareResponse({
    body: input.body,
    rawContent: verdict.content,
    toolsActive,
    parallelEnabled,
    requestId: input.requestId,
    reasoningContent: verdict.reasoningText,
  })
}
