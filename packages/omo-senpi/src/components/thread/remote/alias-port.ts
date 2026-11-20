// The alias port's types in a file that imports nothing, so the remote module's public types (remote/types.ts) can name
// AliasRegistry without reaching ports.ts and, through it, the device service's runtime. ports.ts re-exports them.

export type AliasHolder = { readonly session_id: string; readonly device: string }

export type AliasErrorCode = "alias_taken" | "alias_invalid" | "alias_not_found" | "alias_registry_unavailable"

export type AliasError = {
  readonly code: AliasErrorCode
  readonly message: string
  readonly details?: { readonly holder?: AliasHolder; readonly reason?: string }
}

export type AliasResult<T> =
  { readonly kind: "ok"; readonly value: T } | { readonly kind: "error"; readonly error: AliasError }

/** Frozen port v1 (`o8/alias-port.v1.ts`): the account service's alias registry implements exactly this. */
export type AliasRegistry = {
  readonly claim: (input: {
    readonly alias: string
    readonly holder: AliasHolder
    readonly idempotency_key: string
  }) => Promise<AliasResult<{ readonly alias: string; readonly holder: AliasHolder }>>
  readonly rename: (input: {
    readonly session_id: string
    readonly from: string
    readonly to: string
    readonly idempotency_key: string
  }) => Promise<AliasResult<{ readonly alias: string; readonly holder: AliasHolder }>>
  readonly release: (input: {
    readonly session_id: string
    readonly alias: string
  }) => Promise<AliasResult<{ readonly released: boolean }>>
  readonly resolve: (alias: string) => Promise<AliasResult<AliasHolder>>
  readonly aliasesOf: (sessionIds: readonly string[]) => Promise<AliasResult<ReadonlyMap<string, string>>>
}
