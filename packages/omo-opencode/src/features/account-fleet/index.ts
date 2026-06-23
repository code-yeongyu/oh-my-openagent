// PORT-TODO(account-fleet): full module deferred. Stub provides types only; runtime calls throw.

// ── Type aliases ──────────────────────────────────────────────────────

export type ProviderId = string
export type AccountId = string
export type ProxyBindingId = string

export type LifecycleState =
  | "pending"
  | "bootstrapping"
  | "active"
  | "muted"
  | "quarantined"
  | "paused"
  | "retired"
  | "ip_rotated"

export type AdminState = "enabled" | "disabled" | "drain"
export type ActorType = "system" | "admin" | "scheduler"
export type EventOutcome = "success" | "failure"
export type EventResourceType = "account" | "proxy_binding" | "lease"

export type ProviderType =
  | "openai_compatible"
  | "anthropic"
  | "google"
  | "custom_http"

export type ProviderAuthKind =
  | "bearer_token"
  | "api_key_header"
  | "cookie_session"
  | "oauth2"
  | "none"

export type BindingPolicy =
  | { kind: "required" }
  | { kind: "optional" }
  | { kind: "forbidden" }

// ── Entity types ──────────────────────────────────────────────────────

export type ProviderMetadata = {
  readonly id: ProviderId
  readonly name: string
  readonly provider_type: ProviderType
  readonly base_url: string
  readonly supported_models: ReadonlyArray<string>
  readonly default_binding_policy: BindingPolicy
  readonly auth_kind: ProviderAuthKind
  readonly aux: Readonly<Record<string, unknown>>
}

export type Account = {
  readonly id: AccountId
  readonly provider_id: ProviderId
  readonly display_name: string
  readonly encrypted_auth: string
  readonly lifecycle_state: LifecycleState
  readonly admin_state: AdminState
  readonly error_score: number
  readonly last_validated_at: number | null
  readonly capabilities: string
  readonly aux_info: string
  readonly pseudonym_id: string | null
  readonly created_at: number
  readonly updated_at: number
}

export type ProxyBinding = {
  readonly id: ProxyBindingId
  readonly account_id: AccountId
  readonly proxy_url_encrypted: string
  readonly expires_at: number
  readonly idle_timeout_at: number | null
  readonly created_at: number
}

export type RuntimeLease = {
  readonly id: RuntimeLeaseId
  readonly account_id: AccountId
  readonly proxy_binding_id: ProxyBindingId | null
  readonly acquired_at: number
  readonly released_at: number | null
  readonly aux_info: string
}

export type AccountEvent = {
  readonly id: number
  readonly occurred_at: number
  readonly actor_type: ActorType
  readonly actor_id: string | null
  readonly action: string
  readonly resource_type: EventResourceType
  readonly resource_id: string
  readonly key_id: string | null
  readonly outcome: EventOutcome
  readonly aux_info: string
}

export type RuntimeLeaseId = string

// ── AccountFleet type ─────────────────────────────────────────────────

export type AccountFleet = {
  readonly accounts: {
    getById(id: AccountId): Account
    create(input: Record<string, unknown>): Account
  }
  readonly bindings: {
    getById(id: ProxyBindingId): ProxyBinding | undefined
    create(input: Record<string, unknown>): ProxyBinding
  }
  readonly leases: {
    getById(id: RuntimeLeaseId): RuntimeLease | undefined
  }
  readonly events: Record<string, never>
  readonly providers: {
    getById(id: ProviderId): ProviderMetadata | undefined
    upsert(meta: ProviderMetadata): void
    size(): number
  }
  readonly pool: {
    acquire(opts: {
      provider_id?: ProviderId
      required_capability?: string
    }):
      | { kind: "acquired"; account: { id: AccountId }; lease: { id: string }; binding?: ProxyBinding }
      | { kind: "no_capacity" }
      | { kind: "no_eligible_account" }
    release(leaseId: string): void
  }
  readonly poolPriority: Record<string, never>
  readonly pseudonymizer: Record<string, never>
  readonly accountCatalog: Record<string, never>
  readonly orchestrator: Record<string, never>
  readonly bootstrap: Record<string, never>
  decrypt(serializedEnvelope: string): string
  decryptAuth(account: Account): string
  snapshot(): { pool: { observer: { active_leases: Array<unknown> } } }
  registerValidator(provider_id: ProviderId, validator: unknown): void
  getValidator(provider_id: ProviderId): unknown
  ingestExternalSignup(input: unknown, now?: number): Promise<unknown>
  start(): void
  stop(): void
  drain(timeoutMs: number): Promise<unknown>
}

// ── Throwing factory ──────────────────────────────────────────────────

const NOT_PORTED_ERROR = "account-fleet feature not ported in idm-v2; set IDM_ACCOUNT_FLEET_ENABLED=0 or implement the module"

export function createAccountFleet(_deps: Record<string, unknown>): AccountFleet {
  throw new Error(NOT_PORTED_ERROR)
}

export function newAccountId(): AccountId {
  throw new Error(NOT_PORTED_ERROR)
}

export function newProxyBindingId(): ProxyBindingId {
  throw new Error(NOT_PORTED_ERROR)
}
