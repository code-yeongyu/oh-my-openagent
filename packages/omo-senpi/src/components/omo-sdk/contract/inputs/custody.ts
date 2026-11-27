import type { Readable } from "node:stream"

import { Type } from "typebox"

import type { UserCode } from "../results/custody"

// The credential-bearing calls of the security design (#14945, sections 4.2, 4.3, 5.0 to 5.7). No input carries a secret
// as text: an incoming credential is a readable handle the caller already holds (5.3), and an outgoing one names an
// explicit destination the core verifies (5.2), never a default picked because an argument was left out.
const closed = { additionalProperties: false } as const
const Name = Type.String({ minLength: 1 })
const Pid = Type.Integer({ minimum: 1 })
const Optional = Type.Optional

/** A stream the caller already holds; the core reads it once. A string, a path or an environment name is not one. */
export type ReadableHandle = Readable | ReadableStream<Uint8Array>
const Handle = Type.Unsafe<ReadableHandle>({ type: "object" })

const callback = <Fn>() => Type.Unsafe<Fn>({})
const Signal = Optional(Type.Unsafe<AbortSignal>({}))

/**
 * Where a credential goes (5.2): an admitted terminal, or a peer process the core opens its channel to and verifies by
 * executable identity. A pid alone is not an identity, so the peer is named with its start time; nothing names a path.
 */
const Destination = Type.Union([
  Type.Object({ kind: Type.Literal("terminal") }, closed),
  Type.Object({ kind: Type.Literal("peer"), pid: Pid, started_at: Name }, closed),
])

export const AccountSignIn = Type.Object({
  method: Type.Union([Type.Literal("device_code"), Type.Literal("browser")]),
  open_browser: Optional(Type.Boolean()),
  onUserCode: callback<(code: UserCode) => void | Promise<void>>(),
  onOpenUrl: Optional(callback<(url: string) => void | Promise<void>>()),
  deviceName: Optional(Name),
  replace: Optional(Type.Boolean()),
  signal: Signal,
})
export const AccountAdopt = Type.Object({ credential: Handle, replace: Optional(Type.Boolean()) })
export const AccountCredentialsHandOver = Type.Object({
  what: Type.Union([Type.Literal("access_token"), Type.Literal("stored_credential")]),
  destination: Destination,
})
export const AccountKeysInit = Type.Object({})
export const AccountKeysStatus = Type.Object({})

/** The ceremony's own callbacks; the phrase itself only ever reaches the terminal port (5.1). */
export const SyncEnable = Type.Object({
  onCode: callback<(code: string) => void | Promise<void>>(),
  confirm: callback<() => boolean | Promise<boolean>>(),
  signal: Signal,
})
export const SyncRecover = Type.Object({ confirm: callback<() => boolean | Promise<boolean>>(), signal: Signal })

const Provider = Optional(Name)
const Model = Optional(Name)
export const EngineAuthCheck = Type.Object({ provider: Provider, model: Model, refresh: Optional(Type.Boolean()) })
export const EngineAuthCredentials = Type.Object({
  provider: Provider,
  model: Model,
  refresh: Optional(Type.Boolean()),
  destination: Destination,
})
export const EngineAuthApiKey = Type.Object({ provider: Provider, model: Model, destination: Destination })
export const EngineAuthBearerToken = Type.Object({
  provider: Provider,
  model: Model,
  min_expiry_ms: Optional(Type.Integer({ minimum: 0 })),
  destination: Destination,
})
export const EngineTrustEnsure = Type.Object({ wait: Optional(Type.Boolean()), lease_pid: Optional(Pid) })

export const McpOauthLogin = Type.Object({
  server: Name,
  server_url: Optional(Name),
  client_id: Optional(Name),
  scopes: Optional(Type.Array(Name, { minItems: 1 })),
})
export const McpOauthLogout = Type.Object({ server: Name, server_url: Optional(Name) })
export const McpOauthStatus = Type.Object({ server: Optional(Name) })
