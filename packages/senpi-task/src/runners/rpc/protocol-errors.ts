import type { RpcResponse } from "@code-yeongyu/senpi"

import { RpcCommandError } from "./errors"

export function isHarmlessRpcShutdownError(error: unknown): boolean {
  if (!(error instanceof Error) || !("code" in error)) return false
  return (
    error.code === "EPIPE" ||
    error.code === "ERR_STREAM_DESTROYED" ||
    error.code === "ERR_STREAM_WRITE_AFTER_END" ||
    error.code === "EOF"
  )
}

export function commandError(response: RpcResponse, expectedCommand: string): RpcCommandError {
  if (!response.success) return new RpcCommandError(expectedCommand, response.error, response)
  return new RpcCommandError(expectedCommand, `unexpected response command: ${response.command}`)
}
