export type JsonRpcId = string | number | null

export interface TextContent {
  readonly type: "text"
  readonly text: string
}

export interface McpToolDescriptor {
  readonly name: string
  readonly title?: string
  readonly description: string
  readonly inputSchema: unknown
}

export interface JsonRpcError {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

export interface JsonRpcResult {
  readonly capabilities?: Record<string, unknown>
  readonly serverInfo?: Record<string, unknown>
  readonly protocolVersion?: string
  readonly tools?: McpToolDescriptor[]
  readonly content?: readonly TextContent[]
  readonly isError?: boolean
  readonly [key: string]: unknown
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0"
  readonly id: JsonRpcId
  readonly result?: JsonRpcResult
  readonly error?: JsonRpcError
}

export type McpLifecycleLog = (event: string, fields?: Record<string, boolean | number | string | null>) => void
