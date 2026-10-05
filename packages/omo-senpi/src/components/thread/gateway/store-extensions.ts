import type { BindingRecord } from "./bindings"
import type { GatewayRelay } from "./relay"
import type { SqlRow, SqlValue } from "./sql"

/**
 * One extension op a session may call: through its own named tool (`ToolSessionOp`), or only from
 * its own component (`InternalSessionOp`). The store worker
 * stamps the engine-resolved caller into the op's args (`caller_session_durable_id`, plus
 * `caller_created_target: true` when the caller thread_create'd `args[targetArg]`); the public
 * `extensionCall` refuses the op, its `statusOp` and its `expireOp` with `caller_not_allowed`.
 */
export type SessionCallableOp = ToolSessionOp | InternalSessionOp

type SessionOpCore = {
  readonly op: string
  /** A plain draft-07 JSON Schema with an object root and `additionalProperties: false`. */
  readonly parameters: Readonly<Record<string, unknown>>
  /** The args field naming the target session's durable id; it must be a key of `parameters.properties`. */
  readonly targetArg?: string
}

/** A session op the model calls as its own tool. */
export type ToolSessionOp = SessionOpCore & {
  readonly internal?: undefined
  /** The short name `^[a-z][a-z0-9_]{1,40}$`; the session's tool is `ext_<extension name>_<toolName>`, at most 64 characters. */
  readonly toolName: string
  readonly description: string
  /** When the op's result carries `await_request_id`, the tool waits on `<wakeDir>/<await_request_id>`. */
  readonly await?: { readonly statusOp: string; readonly expireOp: string; readonly timeoutMs: number }
  /** A file in `wakeDir` touched (temp + rename) after a committed successful call. */
  readonly wake?: string
}

/**
 * A session op only the session's own component calls (`extensionSessionAwait` with the caller it
 * knows), never the model: it gets no tool, so it declares no `toolName`, `await` or `wake`. The
 * caller is stamped and the public `extensionCall` refuses it exactly as for a tool op.
 */
export type InternalSessionOp = SessionOpCore & {
  readonly internal: true
  readonly description?: string
}

export type StoreExtensionRegistration = {
  readonly name: string
  readonly migrations: readonly (readonly string[])[]
  /** Absolute file URL of compiled JavaScript, imported by the store worker. */
  readonly moduleUrl: string
  readonly sessionCallable?: readonly SessionCallableOp[]
  /** One path segment under the gateway store's directory holding the await and wake files; the connector creates it. */
  readonly wakeDir?: string
}

export type StoreExtensionRefusalCode =
  | "invalid_arguments"
  | "caller_not_allowed"
  | "caller_context_missing"
  | "extension_import_failed"
  | "extension_unknown_op"
  | "extension_unknown_name"
  | "extension_schema_violation"
  | "extension_operation_failed"
  | "gateway_lock_wait_exceeded"
  | "gateway_schema_too_new"
  /** An await ended without a final status (expiring it, or the status read after, was refused): the request may still complete. */
  | "await_unresolved"

export type StoreExtensionRefusal = {
  readonly kind: "refused"
  readonly code: StoreExtensionRefusalCode
  readonly message: string
}

export type StoreExtensionResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | StoreExtensionRefusal

export type StoreExtensionTransaction = {
  readonly all: (columns: readonly string[], sql: string, params?: readonly SqlValue[], orderBy?: string) => readonly SqlRow[]
  readonly one: (columns: readonly string[], sql: string, params?: readonly SqlValue[]) => SqlRow | undefined
  readonly exec: (sql: string, params?: readonly SqlValue[]) => number
  readonly enqueue: GatewayRelay["inbound"]
  readonly outboxAck: GatewayRelay["ack"]
  readonly bind: GatewayRelay["bind"]
  readonly unbind: GatewayRelay["unbind"]
  readonly rebind: GatewayRelay["rebind"]
  readonly bindingFor: (request: {
    readonly platform: string
    readonly account_id: string
    readonly chat_id: string
    readonly thread_id: string
  }) => Promise<BindingRecord | null>
  /** The session's active bindings (not expired at the transaction's now), ordered by binding_id; a read in the op's own transaction. */
  readonly bindingsForSession: (sessionDurableId: string) => Promise<readonly BindingRecord[]>
  readonly outboxPending: GatewayRelay["outbox"]
}

/** Export each operation by name from the compiled module. Arguments/results must be structured-cloneable. */
export type StoreExtensionOperation = (tx: StoreExtensionTransaction, args: unknown) => unknown | Promise<unknown>

export type StoreExtensionApi = {
  readonly registerStoreExtension: (extension: StoreExtensionRegistration) => Promise<StoreExtensionResult<{ readonly version: number }>>
  readonly extensionCall: <T = unknown>(name: string, op: string, args: unknown) => Promise<StoreExtensionResult<T>>
}

/** A declared session op as every process lists it from the store (`extension_registrations`). */
export type DeclaredSessionOp = ToolSessionOp & {
  readonly extension: string
  /** The tool's name in a session: `ext_<extension>_<toolName>`. */
  readonly registeredName: string
}

/** The engine-resolved caller a session call runs as; never taken from the op's arguments. */
export type SessionCaller = { readonly callerDurableId: string }

/**
 * The session channel: reachable only from the session's own extension tools (never the SDK), so
 * the caller a session-callable op sees is always the one the engine resolved.
 */
export type StoreExtensionSessionApi = {
  /** Every session op declared in the store that the model calls as a tool (internal ops are not listed); a read that imports no module. */
  readonly sessionCallableOps: () => Promise<readonly DeclaredSessionOp[]>
  /** Runs a declared op as `caller`, then its declared `await` when the result carries `await_request_id`; otherwise the op's own result. */
  readonly extensionSessionAwait: <T = unknown>(name: string, op: string, args: unknown, caller: SessionCaller) => Promise<StoreExtensionResult<T>>
}
