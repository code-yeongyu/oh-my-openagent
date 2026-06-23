import type { JsonRpcRequest } from "./json-rpc-message"

export interface SendRequestOptions {
  sessionKey?: string
}

export interface ReasoningCoreTransport {
  /**
   * Send a single JSON-RPC request and receive the response payload.
   * Implementations MUST throw {@link ReasoningCoreInfrastructureError} on
   * infrastructure failures (spawn, network, timeout, init, invalid response).
   * They MUST return successful JSON-RPC responses as plain objects.
   * When a sessionKey is provided, subsequent calls with the same key MUST
   * share state on the reasoning-core side (e.g. same MCP session).
   */
  sendRequest(message: JsonRpcRequest, options?: SendRequestOptions): Promise<unknown>

  /**
   * Release any resources held by the transport. After dispose, sendRequest
   * must not be called again.
   */
  dispose(): void

  /**
   * Optional: release state associated with a specific sessionKey while
   * keeping the transport alive for other sessions.
   */
  disposeSession?(sessionKey: string): void
}

export interface TransportConfig {
  timeoutMs: number
}
