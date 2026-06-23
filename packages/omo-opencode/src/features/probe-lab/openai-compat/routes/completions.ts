import { log } from "../../../../shared/logger"
import { executeChatCompletion } from "../deepseek-chat-executor"
import {
  buildErrorResponse,
  internalError,
  invalidRequest,
  methodNotAllowed,
} from "../errors"
import {
  CapabilityViolationError,
  isSupportedModel,
  resolveCapabilities,
  SUPPORTED_MODEL_IDS,
} from "../model-capability-resolver"
import { loadAccountPool } from "../pool-factory"
import { extractOrGenerateRequestId } from "../request-id"
import { ChatCompletionRequestSchema, type ChatCompletionRequest } from "../schemas"
import { executeChatCompletionStream } from "../streaming-chat-executor"
import type { AccountPool } from "../account-pool"

export type CompletionsHandlerContext = {
  requestId?: string
  executor?: typeof executeChatCompletion
  streamingExecutor?: typeof executeChatCompletionStream
  poolLoader?: typeof loadAccountPool
  pool?: AccountPool
  acquireTimeoutMs?: number
}

const DEFAULT_ACQUIRE_TIMEOUT_MS = 30_000

export async function handleCompletions(
  request: Request,
  ctx?: CompletionsHandlerContext,
): Promise<Response> {
  if (request.method !== "POST") {
    return methodNotAllowed(request.method, "/v1/chat/completions")
  }
  const requestId = ctx?.requestId ?? extractOrGenerateRequestId(request)

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return invalidRequest("Request body must be valid JSON")
  }

  const parsed = ChatCompletionRequestSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const param = issue?.path.join(".") || undefined
    const message = issue?.message ?? "Invalid request body"
    return invalidRequest(message, param)
  }

  const body: ChatCompletionRequest = parsed.data

  if (!isSupportedModel(body.model)) {
    return buildErrorResponse(
      400,
      "invalid_request_error",
      `Unknown model: ${body.model}. Supported: ${SUPPORTED_MODEL_IDS.join(", ")}`,
      "model",
      "model_not_found",
    )
  }
  try {
    resolveCapabilities(body.model, body)
  } catch (err) {
    if (err instanceof CapabilityViolationError) {
      return buildErrorResponse(
        400,
        "invalid_request_error",
        err.message,
        undefined,
        err.code,
      )
    }
    throw err
  }

  let pool: AccountPool
  try {
    pool = ctx?.pool ?? (ctx?.poolLoader ?? loadAccountPool)()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(
      `openai-compat-completions: pool load failed [rid=${requestId}]: ${msg}`,
    )
    return internalError(`provider load failed: ${msg}`)
  }

  let acquired
  try {
    acquired = await pool.acquire(
      ctx?.acquireTimeoutMs ?? DEFAULT_ACQUIRE_TIMEOUT_MS,
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log(`openai-compat-completions: pool acquire failed [rid=${requestId}]: ${msg}`)
    return buildErrorResponse(
      503,
      "rate_limit_error",
      `account pool busy: ${msg}`,
    )
  }

  const { account, release } = acquired

  if (body.stream === true) {
    const streamExec = ctx?.streamingExecutor ?? executeChatCompletionStream
    let response: Response
    try {
      response = await streamExec({
        provider: account.provider,
        baseUrl: account.baseUrl,
        creds: account.creds,
        body,
        requestId,
        accountId: account.id,
      })
    } catch (err) {
      release()
      throw err
    }
    return wrapWithRelease(response, release)
  }

  const exec = ctx?.executor ?? executeChatCompletion
  let result
  try {
    result = await exec({
      provider: account.provider,
      baseUrl: account.baseUrl,
      body,
      requestId,
      accountId: account.id,
    })
  } finally {
    release()
  }
  if (!result.ok) {
    return buildErrorResponse(result.httpStatus, result.errorType, result.message)
  }
  return Response.json(result.response, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
    },
  })
}

function wrapWithRelease(response: Response, release: () => void): Response {
  if (!response.body) {
    release()
    return response
  }
  const upstream = response.body
  const released = { done: false }
  const tryRelease = () => {
    if (released.done) return
    released.done = true
    release()
  }
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null
  const wrapped = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader()
      activeReader = reader
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
        controller.close()
      } catch (err) {
        try {
          controller.error(err)
        } catch {
          void 0
        }
      } finally {
        tryRelease()
      }
    },
    cancel(reason) {
      if (activeReader) {
        void activeReader.cancel(reason)
      } else {
        void upstream.cancel(reason)
      }
      tryRelease()
    },
  })
  return new Response(wrapped, {
    status: response.status,
    headers: response.headers,
  })
}
