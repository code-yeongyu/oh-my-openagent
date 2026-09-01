import type { JsonRpcId, JsonRpcResponse, JsonRpcResult } from "./types.js"

export function successResponse(id: JsonRpcId, result: JsonRpcResult): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result }
}

export function errorResponse(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: data === undefined ? { code, message } : { code, message, data } }
}

export function jsonRpcId(value: unknown): JsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null
}

export function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
