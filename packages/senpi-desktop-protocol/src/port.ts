import type { EngineMethod, ErrorCode } from "./engine-schema.generated"
import type { JsonRpcErrorData, JsonRpcNotification } from "./json-rpc"

/** Per-call options a port honours; a port that cannot cancel ignores them. */
export interface RpcCallOptions {
  /** Abort cancels the request (`$/cancel` on a JSON-RPC port). */
  readonly signal?: AbortSignal
  /** Expiry cancels the request the same way. */
  readonly timeoutMs?: number
}

/** Called once per server-to-client notification, in arrival order. */
export type RpcNotificationListener = (notification: JsonRpcNotification) => void

/** The notification stream of one port. */
export interface RpcNotifications {
  /** Returns the unsubscribe function. */
  subscribe(listener: RpcNotificationListener): () => void
}

/**
 * What `RpcPort.call` rejects with. An engine error reply carries `rpcCode` and `data` (`data.code` names the
 * `ErrorCode`); a failure the port itself produces (timeout, cancel, closed child) carries `code` instead.
 * `nothingSent` is `true` only when the port knows the request never reached the engine.
 */
export interface RpcPortFailure {
  readonly message: string
  readonly rpcCode?: number
  readonly data?: JsonRpcErrorData | null
  readonly code?: ErrorCode
  readonly nothingSent?: boolean
}

/**
 * One JSON-RPC connection to a desktop engine session, as the SDK sees it. The desktop service implements it
 * over its engine child; tests implement it over the fake engine. `call` resolves with the raw `result` (the
 * caller validates it) or rejects with an `RpcPortFailure`.
 */
export interface RpcPort {
  call(method: EngineMethod, params: unknown, options?: RpcCallOptions): Promise<unknown>
  readonly notifications: RpcNotifications
  /** Ends the connection; only the port's owner calls it. */
  close(): Promise<void>
}
