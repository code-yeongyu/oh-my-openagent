import { type Static, Type } from "typebox"

// What the credential-bearing calls answer (security design #14945, 5.0 to 5.7, 8.2): the non-secret part only. Each
// answer is a closed schema, so a field cannot be added without a test noticing (s0-contract.test.ts), and no answer has
// a field a secret could ride in. The device-code event is the one exception by design: it is the argument of the
// person's own `onUserCode` callback, the custody matrix's destination for those codes, never part of a result.
const closed = { additionalProperties: false } as const
const Text = Type.String({ minLength: 1 })
const Pid = Type.Integer({ minimum: 1 })
const Device = Type.Object({ id: Text, name: Text }, closed)

/** The destination record of 8.2: where the secret went, by identity, never the value. */
export const DeliveredTo = Type.Union([
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

export const HandedOver = Type.Object(
  {
    delivered: Type.Literal(true),
    device: Device,
    expires_at: Text,
    owner: Type.Optional(Text),
    destination: DeliveredTo,
  },
  closed,
)

export const ProviderCredentialDelivered = Type.Object(
  { delivered: Type.Literal(true), provider: Text, expires_at: Type.Optional(Text), destination: DeliveredTo },
  closed,
)

export const Adopted = Type.Object({ device: Device, storage: Type.Enum(["omo", "login"]) }, closed)

export const SignedIn = Type.Object(
  {
    api: Text,
    device: Device,
    replaced_device: Type.Optional(Text),
    device_service: Type.Enum(["on", "kept_off", "not_on", "background"]),
  },
  closed,
)

export const Keyring = Type.Object({ device_id: Text, signing_public_key: Text, sealing_public_key: Text }, closed)

export const SyncEnabled = Type.Object({ enabled: Type.Literal(true) }, closed)
export const SyncRecovered = Type.Object({ recovered: Type.Literal(true) }, closed)

const Epoch = Type.Integer({ minimum: 0 })

const AccountFields = {
  name: Text,
  displayName: Type.Optional(Text),
  source: Type.Enum(["login", "import", "env"]),
  blocked: Type.Boolean(),
  blockedReason: Type.Optional(Type.Enum(["auth_error", "rate_limit", "disabled"])),
  blockedUntil: Type.Optional(Epoch),
  pinned: Type.Boolean(),
  blockedModels: Type.Optional(Type.Array(Type.Object({ model: Text, until: Epoch }, closed))),
  unused: Type.Optional(Type.Literal(true)),
  route: Type.Optional(Type.Enum(["siwc", "legacy"])),
  planUsageEnabled: Type.Optional(Type.Boolean()),
  signedOut: Type.Optional(Type.Boolean()),
  store: Type.Optional(Type.Literal("claude-cli")),
  signedInAt: Type.Optional(Epoch),
  signIn: Type.Optional(Type.Enum(["signed_in", "needs_sign_in"])),
  active: Type.Optional(Type.Boolean()),
  paused: Type.Optional(Type.Literal(true)),
}

/** What the provider's profile supplies, as `omo auth check --json` prints it to a person or a script. */
const ProviderFields = {
  email: Type.Optional(Text),
  orgName: Type.Optional(Text),
  subscriptionType: Type.Optional(Text),
  usageUrl: Type.Optional(Text),
}

const CheckCore = {
  model: Text,
  outcome: Type.Enum(["ok", "failed"]),
  status: Type.Optional(Type.Integer()),
  at: Epoch,
}

/** The engine's CredentialAccountSummary (core/credential-accounts.ts), as `omo auth check --json` prints it. */
const AuthAccount = Type.Object(
  {
    ...AccountFields,
    ...ProviderFields,
    check: Type.Optional(
      Type.Object({ ...CheckCore, reason: Type.Optional(Text), message: Type.Optional(Type.String()) }, closed),
    ),
  },
  closed,
)

/**
 * The connection test's result as a session receives it: a code from a closed list, never the provider's own text, which
 * can echo a key fragment. The engine builds the code (slice E1a-s).
 */
export const SESSION_CHECK_CODES = ["auth_error", "account_disabled", "rate_limit", "other"] as const

/**
 * An account as a session receives it (security design 4.3, the owner's option (c) at 137d6b9879): whether it is signed
 * in, and status codes from closed sets. No string at all: not its name, its email or its organisation name, which stay
 * on the person's and script's answer, and no text a provider returned.
 */
const SessionAuthAccount = Type.Object(
  {
    signedIn: Type.Boolean(),
    source: Type.Enum(["login", "import", "env"]),
    blocked: Type.Boolean(),
    blockedReason: Type.Optional(Type.Enum(["auth_error", "rate_limit", "disabled"])),
    check: Type.Optional(
      Type.Object(
        { outcome: Type.Enum(["ok", "failed"]), code: Type.Optional(Type.Enum([...SESSION_CHECK_CODES])) },
        closed,
      ),
    ),
  },
  closed,
)

const AuthStatusFields = {
  status: Type.Enum(["ready", "not_ready", "invalid"]),
  provider: Text,
  reason: Type.Optional(
    Type.Enum(["provider_not_found", "credentials_not_configured", "credential_not_available", "invalid_state"]),
  ),
  authType: Type.Optional(Type.Enum(["api_key", "oauth"])),
}

/** `omo auth check --json` without --credentials, for a person or a script: status and accounts, never the credential. */
export const AuthStatus = Type.Object({ ...AuthStatusFields, accounts: Type.Array(AuthAccount) }, closed)

/** The same call's answer to a session: whether each account is signed in, the provider, and closed status codes. */
export const SessionAuthStatus = Type.Object({ ...AuthStatusFields, accounts: Type.Array(SessionAuthAccount) }, closed)

/** Fields of a person's or script's answer that may embed provider-returned text; never part of a session's answer. */
export const MAY_EMBED = { "engine.auth.check": ["accounts[].check.reason", "accounts[].check.message"] } as const

/** Answers a session principal receives where they differ from the person's and the script's. */
export const SESSION_RESULTS = { "engine.auth.check": SessionAuthStatus } as const

export const TrustEnsured = Type.Object({ action: Type.Literal("ensure"), generation: Text }, closed)

export const McpLoggedIn = Type.Object(
  { server: Text, stored: Type.Literal(true), expires_at: Type.Optional(Text) },
  closed,
)
export const McpLoggedOut = Type.Object({ server: Text, removed: Type.Boolean() }, closed)
export const McpStatus = Type.Object(
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
