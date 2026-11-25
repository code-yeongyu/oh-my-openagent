import type { AwaitingRevision, CallAlias } from "./authority-check"
import type { Taken } from "./custody-check"

// What slice P1a-s's tests hold the tree to (#14949). HELD is P1a's GATED table as it stood at a5138c95d9 (#14977), each
// entry with how it left: typed here, or the reason it has no call. CUSTODY_FIELDS is the whole non-secret answer of
// each credential-bearing call (security design 5.2 to 5.7, 8.2); a field added to one fails the custody test.
const typed = (...entries: string[]): Taken[] => entries.map((entry) => ({ entry, typed: true }))

export const HELD: readonly Taken[] = [
  ...typed("root.endpoint", "root.principal", "root.api", "root.accounts"),
  ...typed(
    "account.signIn",
    "account.adopt",
    "account.credentials.handOver",
    "account.keys.init",
    "account.keys.status",
  ),
  {
    entry: "account.audit.list",
    typed: false,
    disposition: "the registry has no row for it; the slice that adds the custody log (8.2) adds the row and its call",
  },
  {
    entry: "account.peers",
    typed: false,
    disposition:
      "no call exists and none may: the peer allowlist ships with the build and no caller enrols a peer (5.2)",
  },
  ...typed("sync.enable", "sync.recover"),
  ...typed("engine.auth.check", "engine.auth.credentials", "engine.auth.apiKey", "engine.auth.bearerToken"),
  ...typed("engine.trust.ensure"),
  ...typed(
    "engine.launch.interactive",
    "engine.launch.print",
    "engine.launch.rpc",
    "engine.launch.hand",
    "engine.launch.headless",
  ),
  ...typed("mcp.oauth.login", "mcp.oauth.logout", "mcp.oauth.status"),
  ...typed("threads.attach", "threads.extensions.sessionOps", "threads.extensions.sessionCall"),
  ...typed("threads.runToCompletion"),
  ...typed(
    "toolkit.forSession",
    "toolkit.addGoal",
    "toolkit.checkpoint",
    "toolkit.completeGoals",
    "toolkit.createGoals",
    "toolkit.criteria",
    "toolkit.recordEvidence",
    "toolkit.recordReviewBlockers",
    "toolkit.status",
    "toolkit.steer",
  ),
  ...typed("threads.send#author", "threads.sendAndFollow#author", "threads.create#launch_spec"),
  ...typed("threads.create#prompt.author", "threads.extensions.register#sessionCallable"),
  ...typed("daemon.ensure#launch_spec", "daemon.ensure#mcp_presenter_enforcement", "daemon.handoff#launch_spec"),
  ...typed("install.plugin#codex_autonomous", "engine.models.list#setup", "engine.promptSizes#setup"),
]

const DEVICE = ["device", "device.id", "device.name"]
const DELIVERED_TO = [
  "destination",
  "destination.kind",
  "destination.tty",
  "destination.session_id",
  "destination.leader_pid",
  "destination.leader_started_at",
  "destination.host_identity",
  "destination.host_pid",
  "destination.host_started_at",
  "destination.uid",
  "destination.executable_identity",
  "destination.pid",
  "destination.started_at",
  "destination.allowlist_entry",
]
const KEYRING = ["device_id", "signing_public_key", "sealing_public_key"]
const PROVIDER_DELIVERED = ["delivered", "provider", "expires_at", ...DELIVERED_TO]

export const CUSTODY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "account.credentials.handOver": ["delivered", ...DEVICE, "expires_at", "owner", ...DELIVERED_TO],
  "account.adopt": [...DEVICE, "storage"],
  "account.signIn": ["api", ...DEVICE, "replaced_device", "device_service"],
  "account.keys.init": KEYRING,
  "account.keys.status": KEYRING,
  "sync.enable": ["enabled"],
  "sync.recover": ["recovered"],
  "engine.auth.check": [
    "status",
    "provider",
    "reason",
    "authType",
    "accounts",
    ...[
      "",
      ".name",
      ".displayName",
      ".source",
      ".blocked",
      ".blockedReason",
      ".blockedUntil",
      ".pinned",
      ".blockedModels",
      ".blockedModels[]",
      ".blockedModels[].model",
      ".blockedModels[].until",
      ".unused",
      ".route",
      ".planUsageEnabled",
      ".signedOut",
      ".store",
      ".signedInAt",
      ".email",
      ".orgName",
      ".subscriptionType",
      ".check",
      ".check.model",
      ".check.outcome",
      ".check.code",
      ".check.message",
      ".check.status",
      ".check.at",
      ".check.provider_text",
      ".check.provider_text.reason",
      ".check.provider_text.message",
      ".signIn",
      ".active",
      ".paused",
      ".usageUrl",
    ].map((path) => `accounts[]${path}`),
  ],
  "engine.auth.credentials": PROVIDER_DELIVERED,
  "engine.auth.apiKey": PROVIDER_DELIVERED,
  "engine.auth.bearerToken": PROVIDER_DELIVERED,
  "engine.trust.ensure": ["action", "generation"],
  "mcp.oauth.login": ["server", "stored", "expires_at"],
  "mcp.oauth.logout": ["server", "removed"],
  "mcp.oauth.status": [
    "servers",
    "servers[]",
    "servers[].server",
    "servers[].authenticated",
    "servers[].expired",
    "servers[].expires_at",
  ],
}

const KEYS_ROW =
  "`account.adopt`, `account.credentials.handOver`, `account.store.*`, `account.keys.*` except `account.keys.status` (4.4: it reports state and no key material)"

/** Names in section 4 that are not a registry id, or not the call a token would resolve to: what each means, and why. */
export const CALL_ALIASES: readonly CallAlias[] = [
  {
    docRow: "`engine.auth.apiKey`, `bearerToken`, `check` with credentials; `mcp.oauth.login`, `logout`",
    token: "check",
    calls: ["engine.auth.credentials"],
    why: "`check` with credentials is the credential-returning call (first-party design 6.8)",
  },
  {
    docRow: "`deviceService.setEnabled`, `setControl`, `setWake`",
    token: "deviceService.setEnabled",
    calls: ["deviceService.enable", "deviceService.disable"],
    why: "the registry's two rows for the one setEnabled switch (first-party design 6.5)",
  },
  {
    docRow: KEYS_ROW,
    token: "account.keys.*",
    calls: ["account.keys.init"],
    why: "the row excepts account.keys.status, which 4.4 lists as a read",
  },
  {
    docRow: KEYS_ROW,
    token: "account.keys.status",
    calls: [],
    why: "named as the row's exception, not as one of its calls",
  },
]

/** Where the matrix follows a ruling ahead of the document; each fails as stale once the revision lands. None open. */
export const AWAITING_REVISION: readonly AwaitingRevision[] = []

/** The session's answer of engine.auth.check (option (c), the engine's shape at 56cddc3b81). */
export const SESSION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "engine.auth.check": [
    "status",
    "provider",
    "reason",
    "auth_type",
    "accounts",
    "accounts[]",
    "accounts[].signed_in",
    "accounts[].check",
  ],
}

/** The day omo's engine pin exports the engine's contract, delete the snapshot and import it (the engine pin's PR owns it). */
export const AWAITING_ENGINE_PIN = {
  why: "the engine exports AuthStatus, SessionAuthStatus and RESULT_FREE_FIELDS only at senpi#7463 (56cddc3b81), not at omo's pin",
} as const
