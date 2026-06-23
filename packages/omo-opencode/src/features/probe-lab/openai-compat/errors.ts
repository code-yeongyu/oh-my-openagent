export const OPENAI_ERROR_TYPES = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "rate_limit_error",
  "internal_error",
  "not_implemented",
  "truncated_stream",
  "empty_sse",
  "empty_output_after_retry",
  "upstream_contract_violation",
] as const

export type OpenAIErrorType = (typeof OPENAI_ERROR_TYPES)[number]

export type OpenAIErrorBody = {
  error: {
    message: string
    type: OpenAIErrorType
    param?: string
    code?: string
  }
}

export function buildErrorBody(
  type: OpenAIErrorType,
  message: string,
  param?: string,
  code?: string,
): OpenAIErrorBody {
  const error: OpenAIErrorBody["error"] = { message, type }
  if (param !== undefined) error.param = param
  if (code !== undefined) error.code = code
  return { error }
}

export function buildErrorResponse(
  status: number,
  type: OpenAIErrorType,
  message: string,
  param?: string,
  code?: string,
): Response {
  return Response.json(buildErrorBody(type, message, param, code), {
    status,
    headers: { "content-type": "application/json" },
  })
}

export function unauthorized(message = "Missing or invalid Bearer token"): Response {
  return buildErrorResponse(401, "authentication_error", message)
}

export function notFound(path: string): Response {
  return buildErrorResponse(404, "not_found_error", `No route for ${path}`)
}

export function methodNotAllowed(method: string, path: string): Response {
  return buildErrorResponse(
    405,
    "invalid_request_error",
    `Method ${method} not allowed on ${path}`,
  )
}

export function invalidRequest(message: string, param?: string): Response {
  return buildErrorResponse(400, "invalid_request_error", message, param)
}

export function notImplemented(message: string): Response {
  return buildErrorResponse(501, "not_implemented", message)
}

export function internalError(message = "Internal server error"): Response {
  return buildErrorResponse(500, "internal_error", message)
}
