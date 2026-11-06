export type JsonObject = { readonly [key: string]: unknown }

/** One row of the account-scoped session list (the device service's `sessions.list` listing). */
export type RemoteSessionRow = {
  readonly device: string
  readonly session_id: string
  readonly title: string
  readonly project: string
  /** The session file on its own device; `open_session` on that device takes it. */
  readonly path: string
  readonly state: string
  readonly updated_ms: number
}

export type RemoteDevice = { readonly device: string; readonly label: string; readonly online: boolean }

/**
 * How a command sent to another device ended. `refused` carries the receiving side's reason
 * (`capability_missing` without a grant, `host_detached` when the device is not attached to the relay);
 * `uncertain` means it may have run (the relay lost the evidence), so it is never retried blindly.
 */
export type RemoteCommandOutcome =
  | { readonly kind: "ok"; readonly response: JsonObject }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "uncertain"; readonly reason: string }

export type RemoteServiceState = { readonly state: string }

export type RemoteLocateOutcome =
  | { readonly kind: "ok"; readonly sessionId: string }
  | { readonly kind: "refused"; readonly reason: string }

export type RemoteSessionsPort = {
  /** The device service state; `plan_required` means the account's plan has no relay (A5: paid only). */
  readonly status: () => Promise<RemoteServiceState>
  readonly thisDevice: () => Promise<string | null>
  readonly devices: () => Promise<readonly RemoteDevice[]>
  readonly sessions: () => Promise<readonly RemoteSessionRow[]>
  /**
   * A session-less engine record (`open_session`, `list_sessions`) on `device`'s engine endpoint, with no
   * attach: the attach-less `session.command {device, endpoint, rpc}` shape (relay daemon #393).
   */
  readonly endpointCommand: (device: string, rpc: JsonObject) => Promise<RemoteCommandOutcome>
  /**
   * The id a session just created on `device` is addressed by (its listing row's `session_id`, the key an attach
   * takes), from the durable engine session id the create reply names; settles once that id attaches.
   */
  readonly locate: (device: string, engineId: string) => Promise<RemoteLocateOutcome>
  /** An engine record for one session on `device` (`prompt`, `abort`, `get_state`), through an attach. */
  readonly sessionCommand: (device: string, sessionId: string, rpc: JsonObject) => Promise<RemoteCommandOutcome>
  readonly read: (device: string, sessionId: string, tail: number) => Promise<RemoteCommandOutcome>
}

/**
 * The count a thread chain carries to another device (K8; R8.c). The engine record field that holds it is
 * named by senpi S32; until that engine release, `stamp` is the identity and the count does not cross.
 */
export type ChainCountWire = {
  readonly stamp: (record: JsonObject, hop: number) => JsonObject
}

export type AliasHolder = { readonly session_id: string; readonly device: string }

export type AliasErrorCode = "alias_taken" | "alias_invalid" | "alias_not_found" | "alias_registry_unavailable"

export type AliasError = {
  readonly code: AliasErrorCode
  readonly message: string
  readonly details?: { readonly holder?: AliasHolder; readonly reason?: string }
}

export type AliasResult<T> = { readonly kind: "ok"; readonly value: T } | { readonly kind: "error"; readonly error: AliasError }

/** Frozen port v1 (`o8/alias-port.v1.ts`): the account service's alias registry implements exactly this. */
export type AliasRegistry = {
  readonly claim: (input: { readonly alias: string; readonly holder: AliasHolder; readonly idempotency_key: string }) => Promise<AliasResult<{ readonly alias: string; readonly holder: AliasHolder }>>
  readonly rename: (input: { readonly session_id: string; readonly from: string; readonly to: string; readonly idempotency_key: string }) => Promise<AliasResult<{ readonly alias: string; readonly holder: AliasHolder }>>
  readonly release: (input: { readonly session_id: string; readonly alias: string }) => Promise<AliasResult<{ readonly released: boolean }>>
  readonly resolve: (alias: string) => Promise<AliasResult<AliasHolder>>
  readonly aliasesOf: (sessionIds: readonly string[]) => Promise<AliasResult<ReadonlyMap<string, string>>>
}

/** Everything the tools need to reach past this machine. Absent: the tools are exactly the local ones. */
export type RemoteThreadSurface = {
  readonly sessions: RemoteSessionsPort
  /** Absent until the account service's alias registry ships: aliases are then refused typed, never guessed. */
  readonly aliases?: AliasRegistry
  readonly chain: ChainCountWire
}
