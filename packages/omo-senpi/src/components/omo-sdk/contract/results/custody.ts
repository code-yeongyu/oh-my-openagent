import { type Static, Type } from "typebox"

import { AuthStatus, SessionAuthStatus } from "./auth-check"

// What the credential-bearing calls answer (security design #14945, 5.0 to 5.7, 8.2): the non-secret part only. Each
// answer is a closed schema, so a field cannot be added without a test noticing (s0-contract.test.ts), and no answer has
// a field a secret could ride in. The device-code event is the one exception by design: it is the argument of the
// person's own `onUserCode` callback, the custody matrix's destination for those codes, never part of a result.
const closed = { additionalProperties: false } as const
const Text = Type.String({ minLength: 1 })
const Pid = Type.Integer({ minimum: 1 })
const Device = Type.Object({ id: Text, name: Text }, closed)

/** The destination record of 8.2: where the secret went, by identity, never the value. */
const DeliveredTo = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("terminal"),
      tty: Text,
      session_id: Type.Integer({ minimum: 0 }),
      leader_pid: Pid,
      leader_started_at: Text,
      host_identity: Text,
      host_pid: Pid,
      host_started_at: Text,
      uid: Type.Integer({ minimum: 0 }),
    },
    closed,
  ),
  Type.Object(
    { kind: Type.Literal("peer"), executable_identity: Text, pid: Pid, started_at: Text, allowlist_entry: Text },
    closed,
  ),
])

const HandedOver = Type.Object(
  {
    delivered: Type.Literal(true),
    device: Device,
    expires_at: Text,
    owner: Type.Optional(Text),
    destination: DeliveredTo,
  },
  closed,
)

const ProviderCredentialDelivered = Type.Object(
  { delivered: Type.Literal(true), provider: Text, expires_at: Type.Optional(Text), destination: DeliveredTo },
  closed,
)

const Adopted = Type.Object({ device: Device, storage: Type.Enum(["omo", "login"]) }, closed)

const SignedIn = Type.Object(
  {
    api: Text,
    device: Device,
    replaced_device: Type.Optional(Text),
    device_service: Type.Enum(["on", "kept_off", "not_on", "background"]),
  },
  closed,
)

const Keyring = Type.Object({ device_id: Text, signing_public_key: Text, sealing_public_key: Text }, closed)

const SyncEnabled = Type.Object({ enabled: Type.Literal(true) }, closed)
const SyncRecovered = Type.Object({ recovered: Type.Literal(true) }, closed)

const TrustEnsured = Type.Object({ action: Type.Literal("ensure"), generation: Text }, closed)

const McpLoggedIn = Type.Object({ server: Text, stored: Type.Literal(true), expires_at: Type.Optional(Text) }, closed)
const McpLoggedOut = Type.Object({ server: Text, removed: Type.Boolean() }, closed)
const McpStatus = Type.Object(
  {
    servers: Type.Array(
      Type.Object(
        { server: Text, authenticated: Type.Boolean(), expired: Type.Boolean(), expires_at: Type.Optional(Text) },
        closed,
      ),
    ),
  },
  closed,
)

export const CUSTODY_RESULTS = {
  "account.credentials.handOver": HandedOver,
  "account.adopt": Adopted,
  "account.signIn": SignedIn,
  "account.keys.init": Keyring,
  "account.keys.status": Keyring,
  "sync.enable": SyncEnabled,
  "sync.recover": SyncRecovered,
  "engine.auth.check": AuthStatus,
  "engine.auth.credentials": ProviderCredentialDelivered,
  "engine.auth.apiKey": ProviderCredentialDelivered,
  "engine.auth.bearerToken": ProviderCredentialDelivered,
  "engine.trust.ensure": TrustEnsured,
  "mcp.oauth.login": McpLoggedIn,
  "mcp.oauth.logout": McpLoggedOut,
  "mcp.oauth.status": McpStatus,
} as const

export type DeliveredToRecord = Static<typeof DeliveredTo>

/** The device-code `code` event (5.4): only the person's callback receives it. */
export type UserCode = {
  readonly verification_uri: string
  readonly user_code: string
  readonly matching_code: string
  readonly expires_at: string
}

/** Answers a session principal receives where they differ from the person's and the script's. */
export const SESSION_RESULTS = { "engine.auth.check": SessionAuthStatus } as const
