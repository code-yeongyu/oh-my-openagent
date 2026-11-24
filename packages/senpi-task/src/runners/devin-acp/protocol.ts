// Wire shapes for the subset of ACP v1 that `devin acp` speaks. Hand-rolled on purpose: the full
// schema lives in the Agent Client Protocol spec, and this runner only reads the fields below.
// Unknown session/update variants and _meta keys pass through untouched.

export type AcpId = number | string

export interface AcpRequest {
  readonly jsonrpc: "2.0"
  readonly id: AcpId
  readonly method: string
  readonly params?: unknown
}

export interface AcpNotification {
  readonly jsonrpc: "2.0"
  readonly method: string
  readonly params?: unknown
}

export interface AcpResponse {
  readonly jsonrpc: "2.0"
  readonly id: AcpId
  readonly result?: unknown
  readonly error?: { readonly code: number; readonly message: string; readonly data?: unknown }
}

export type AcpServerRequest = AcpRequest

export interface AcpErrorShape {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

export interface AcpInitializeResult {
  readonly protocolVersion?: number
  readonly agentInfo?: { readonly name?: string; readonly version?: string }
  // ACP v2 draft dialect spells the same facts `info`/`capabilities`; detected, never required.
  readonly info?: { readonly name?: string; readonly version?: string }
  readonly agentCapabilities?: Record<string, unknown>
  readonly authMethods?: readonly {
    readonly id?: string
    readonly methodId?: string
    readonly name?: string
    readonly type?: string
  }[]
}

export interface AcpConfigOption {
  readonly id: string
  readonly name?: string
  readonly category?: string
  readonly type?: string
  readonly currentValue?: unknown
  readonly options?: readonly { readonly value: unknown; readonly name?: string }[]
}

export interface AcpSessionResult {
  readonly sessionId?: string
  readonly modes?: {
    readonly currentModeId?: string
    readonly availableModes?: readonly { readonly id: string; readonly name?: string }[]
  }
  readonly configOptions?: readonly AcpConfigOption[]
}

export interface AcpPromptResult {
  readonly stopReason?: string
  readonly usage?: {
    readonly totalTokens?: number
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly [key: string]: unknown
  }
  readonly _meta?: Record<string, unknown>
}

// One `session/update` payload. `sessionUpdate` discriminates; every other field is optional
// because variants differ. `_meta` carries the cognition.ai/* extensions (subagent routing,
// inference tool names, subagent lifecycle).
export interface AcpSessionUpdate {
  readonly sessionUpdate?: string
  readonly content?: { readonly type?: string; readonly text?: string }
  readonly toolCallId?: string
  readonly title?: string
  readonly kind?: string
  readonly status?: string
  readonly rawInput?: unknown
  readonly rawOutput?: unknown
  readonly _meta?: Record<string, unknown>
  readonly [key: string]: unknown
}

export interface AcpSessionUpdateParams {
  readonly sessionId?: string
  readonly update?: AcpSessionUpdate
  readonly _meta?: Record<string, unknown>
}

export interface AcpUsageUpdate {
  readonly used?: number
  readonly size?: number
  readonly _meta?: {
    readonly "cognition.ai/inputTokens"?: number
    readonly "cognition.ai/outputTokens"?: number
    readonly [key: string]: unknown
  }
}
