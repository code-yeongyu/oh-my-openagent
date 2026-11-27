import { type Static, Type } from "typebox"

// engine.auth.check's two answers (security design 4.3 at 137d6b9879), shaped as the engine exports them (slice E1a-s,
// senpi#7463 at 56cddc3b81: AuthStatus, SessionAuthStatus, AUTH_ACCOUNT_CHECK_CODES, RESULT_FREE_FIELDS). omo cannot
// import them until its engine pin carries them; script/sdk-parity/engine-snapshot/ holds that commit's copy and a test
// maps it to these field by field.
const closed = { additionalProperties: false } as const
const Text = Type.String({ minLength: 1 })
const Epoch = Type.Integer({ minimum: 0 })

/** The closed set a connection test's failure is told by; `unrecognized` for a stored reason outside it. */
export const AUTH_ACCOUNT_CHECK_CODES = [
  "rate_limit",
  "overloaded",
  "auth_error",
  "login_unreadable",
  "billing",
  "org_not_allowed",
  "entitlement",
  "long_context_unavailable",
  "other",
  "timeout",
  "cancelled",
  "no_result",
  "unrecognized",
] as const
const CheckCode = Type.Enum([...AUTH_ACCOUNT_CHECK_CODES])

const Status = {
  status: Type.Enum(["ready", "not_ready", "invalid"]),
  provider: Text,
  reason: Type.Optional(
    Type.Enum(["provider_not_found", "credentials_not_configured", "credential_not_available", "invalid_state"]),
  ),
}

/** The connection test split in two: the engine's words from a closed code, and what the provider returned. */
const AccountCheck = Type.Object(
  {
    model: Text,
    outcome: Type.Enum(["ok", "failed"]),
    code: Type.Optional(CheckCode),
    message: Type.String(),
    status: Type.Optional(Type.Integer()),
    at: Epoch,
    provider_text: Type.Optional(
      Type.Object({ reason: Type.Optional(Type.String()), message: Type.Optional(Type.String()) }, closed),
    ),
  },
  closed,
)

/** The engine's AuthAccount: the stored account summary with its connection test split. */
const AuthAccount = Type.Object(
  {
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
    email: Type.Optional(Text),
    orgName: Type.Optional(Text),
    subscriptionType: Type.Optional(Text),
    check: Type.Optional(AccountCheck),
    signIn: Type.Optional(Type.Enum(["signed_in", "needs_sign_in"])),
    active: Type.Optional(Type.Boolean()),
    paused: Type.Optional(Type.Literal(true)),
    usageUrl: Type.Optional(Text),
  },
  closed,
)

/** A person's or script's answer: the check's status and every account, never the credential. */
export const AuthStatus = Type.Object(
  { ...Status, authType: Type.Optional(Type.Enum(["api_key", "oauth"])), accounts: Type.Array(AuthAccount) },
  closed,
)
export type AuthStatusAnswer = Static<typeof AuthStatus>

/**
 * A session's answer (the owner's option (c)): the provider, status codes from closed sets, and for each account only
 * whether it is signed in and its last test as a closed code. No other string, and no text a provider returned.
 */
export const SessionAuthStatus = Type.Object(
  {
    ...Status,
    auth_type: Type.Optional(Type.Enum(["api_key", "oauth"])),
    accounts: Type.Array(
      Type.Object(
        { signed_in: Type.Boolean(), check: Type.Optional(Type.Union([Type.Literal("ok"), CheckCode])) },
        closed,
      ),
    ),
  },
  closed,
)

export type FreeFieldOrigin = "caller" | "configuration" | "provider" | "process" | "engine"
export type FreeField = { readonly field: string; readonly origin: FreeFieldOrigin; readonly may_embed: boolean }

const embeds = <F extends string>(field: F, origin: Exclude<FreeFieldOrigin, "engine">) =>
  ({ field, origin, may_embed: true }) as const

/**
 * Every free string of the person's answer, with where its text comes from; `may_embed` marks text that can carry a
 * credential. The canary test plants into each, and a type check proves the list is every free path of the answer.
 */
export const AUTH_CHECK_FREE_FIELDS = [
  embeds("provider", "caller"),
  embeds("accounts[].name", "configuration"),
  embeds("accounts[].displayName", "configuration"),
  embeds("accounts[].email", "provider"),
  embeds("accounts[].subscriptionType", "provider"),
  embeds("accounts[].orgName", "provider"),
  embeds("accounts[].usageUrl", "configuration"),
  embeds("accounts[].blockedModels[].model", "configuration"),
  embeds("accounts[].check.model", "configuration"),
  { field: "accounts[].check.message", origin: "engine", may_embed: false } as const,
  embeds("accounts[].check.provider_text.reason", "provider"),
  embeds("accounts[].check.provider_text.message", "provider"),
] as const satisfies readonly FreeField[]
