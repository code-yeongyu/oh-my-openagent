import type { BindingRecord } from "./bindings"
import type { GatewayRelay } from "./relay"
import type { SqlRow, SqlValue } from "./sql"

export type StoreExtensionRegistration = {
  readonly name: string
  readonly migrations: readonly (readonly string[])[]
  /** Absolute file URL of compiled JavaScript, imported by the store worker. */
  readonly moduleUrl: string
}

export type StoreExtensionRefusalCode =
  | "invalid_arguments"
  | "extension_import_failed"
  | "extension_unknown_op"
  | "extension_unknown_name"
  | "extension_schema_violation"
  | "extension_operation_failed"
  | "gateway_lock_wait_exceeded"
  | "gateway_schema_too_new"

export type StoreExtensionRefusal = {
  readonly kind: "refused"
  readonly code: StoreExtensionRefusalCode
  readonly message: string
}

export type StoreExtensionResult<T> =
  | { readonly kind: "ok"; readonly value: T }
  | StoreExtensionRefusal

export type StoreExtensionTransaction = {
  /** `orderBy` lists the statement's output columns (`"created_at, id"`); a LIMIT goes in the statement. */
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
  readonly outboxPending: GatewayRelay["outbox"]
}

/** Export each operation by name from the compiled module. Arguments/results must be structured-cloneable. */
export type StoreExtensionOperation = (tx: StoreExtensionTransaction, args: unknown) => unknown | Promise<unknown>

export type StoreExtensionApi = {
  readonly registerStoreExtension: (extension: StoreExtensionRegistration) => Promise<StoreExtensionResult<{ readonly version: number }>>
  readonly extensionCall: <T = unknown>(name: string, op: string, args: unknown) => Promise<StoreExtensionResult<T>>
}
