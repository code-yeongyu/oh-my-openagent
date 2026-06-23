import type { ProbeResponse } from "../providers/provider-types"
import type { OpenAIErrorType } from "./errors"
import { extractSseBodySignals } from "./sse-body-extractor"

export type ResponseClassification =
  | {
      ok: true
      content: string
      reasoningText: string
      responseMessageId: number | null
    }
  | { ok: false; httpStatus: number; errorType: OpenAIErrorType; message: string }

export function classifyDeepSeekResponse(
  res: ProbeResponse,
): ResponseClassification {
  if (res.status !== 200) {
    return {
      ok: false,
      httpStatus: 502,
      errorType: "internal_error",
      message: classifyHttpError(res.status),
    }
  }
  if (looksLikeMissingHeader(res.body)) {
    return {
      ok: false,
      httpStatus: 502,
      errorType: "internal_error",
      message:
        "DeepSeek MISSING_HEADER (biz_code 40300, likely cookie/PoW issue)",
    }
  }
  const signals = extractSseBodySignals(res.body)
  if (signals.empty_sse) {
    return {
      ok: false,
      httpStatus: 502,
      errorType: "empty_sse",
      message:
        "DeepSeek returned HTTP 200 with empty SSE body (probable rate-limit or block)",
    }
  }
  if (signals.terminal_status === null) {
    return {
      ok: false,
      httpStatus: 502,
      errorType: "truncated_stream",
      message: "DeepSeek SSE never reached terminal status (stream truncation)",
    }
  }
  if (signals.terminal_status !== "FINISHED") {
    return {
      ok: false,
      httpStatus: 502,
      errorType: "internal_error",
      message: `unexpected DeepSeek terminal status: ${signals.terminal_status}`,
    }
  }
  return {
    ok: true,
    content: signals.content_text,
    reasoningText: signals.reasoning_text,
    responseMessageId: signals.response_message_id,
  }
}

function classifyHttpError(status: number): string {
  if (status === 401 || status === 403) {
    return `DeepSeek auth failure (HTTP ${status})`
  }
  if (status === 429) return "DeepSeek rate-limited (HTTP 429)"
  return `DeepSeek HTTP ${status}`
}

function looksLikeMissingHeader(body: string): boolean {
  return (
    body.includes("MISSING_HEADER") ||
    body.includes('"biz_code":40300') ||
    body.includes('"biz_code": 40300')
  )
}
