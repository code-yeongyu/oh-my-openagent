export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcSuccessResponse {
  jsonrpc: "2.0"
  id: number
  result: Record<string, unknown>
}

export interface JsonRpcErrorResponse {
  jsonrpc: "2.0"
  id: number
  error: {
    code?: number
    message?: string
    data?: unknown
  }
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse

export function isJsonRpcErrorResponse(response: unknown): response is JsonRpcErrorResponse {
  if (!isRecord(response)) return false
  if (!isRecord(response.error)) return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
