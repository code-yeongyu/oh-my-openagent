// What slice P1a does not type and leaves to slice P1a-s (first-party design 8): every row, field and root option that
// carries a principal, a credential, an endpoint or a launch option. `s0` cites the section of the security design
// (#14945, docs/reference/omo-sdk-authority-and-custody.md) that holds it; an entry that design does not name says why
// in `reason`. The reviewer checks this table against those sections. `rowExists: false` names a row the registry does
// not have yet; the check fails once it appears, so the entry is revisited.
export type GatedEntry = {
  readonly row: string
  readonly field?: string
  readonly s0: readonly string[]
  readonly reason: string
  readonly rowExists: boolean
}

const row = (id: string, s0: readonly string[], reason: string, rowExists = true): GatedEntry => ({
  row: id,
  s0,
  reason,
  rowExists,
})
const field = (id: string, name: string, s0: readonly string[], reason: string): GatedEntry => ({
  row: id,
  field: name,
  s0,
  reason,
  rowExists: true,
})
const root = (name: string, s0: readonly string[], reason: string): GatedEntry => ({
  row: "root",
  field: name,
  s0,
  reason,
  rowExists: true,
})

const CUSTODY = "a credential-bearing call; its custody row decides where the secret goes"
const LAUNCH =
  "a launch operation over LaunchOptions, including spawned_by (session) and bootstrap_fd and enforcement (presenter)"
const LAUNCH_SPEC =
  "a launch option; the host options of 4.4 are the endpoint flags socket and key_root, held as the root's endpoint (design lane ruling, 2026-11-25)"
const LOOP = "bound through toolkit.forSession, whose session binding is a principal row"

export const GATED: readonly GatedEntry[] = [
  root("endpoint", ["4.4"], "the root's endpoint selector (socket, key_root)"),
  root("principal", ["3", "4"], "the principal a root is built for"),
  root("api", ["4.2"], "the account service origin on any account call"),
  root("accounts", ["4.2"], "the sign-in page origin, the second half of the account service origin"),
  row("account.signIn", ["4.2", "5.0"], "the device-code flow and its replace input"),
  row("account.adopt", ["4.2", "5.0"], CUSTODY),
  row("account.credentials.handOver", ["4.2", "5.0"], CUSTODY),
  row("account.keys.init", ["4.4", "5.0"], "creates this device's key material"),
  row(
    "account.keys.status",
    ["4.4"],
    "the keyring group of first-party design 4.5; held with its init by the design lane",
  ),
  row("account.audit.list", ["4.2"], "added by the security design (8.2)", false),
  row("account.peers", ["4.2"], "the peer allowlist configuration added by the security design", false),
  row("sync.enable", ["4.2", "5.0"], "creates and shows the recovery phrase"),
  row("sync.recover", ["4.2", "5.0"], "reads the recovery phrase"),
  row("engine.auth.check", ["4.3"], "provider credentials; a session's refresh is forced off"),
  row("engine.auth.credentials", ["4.3", "5.0"], CUSTODY),
  row("engine.auth.apiKey", ["4.3", "5.0"], CUSTODY),
  row("engine.auth.bearerToken", ["4.3", "5.0"], CUSTODY),
  row("engine.trust.ensure", ["4.3"], "writes the trust store and can lease for another process"),
  row("engine.launch.interactive", ["4.4"], LAUNCH),
  row("engine.launch.print", ["4.4"], LAUNCH),
  row("engine.launch.rpc", ["4.4"], LAUNCH),
  row("engine.launch.hand", ["4.4"], LAUNCH),
  row("engine.launch.headless", ["4.4"], LAUNCH),
  row("mcp.oauth.login", ["4.4", "5.0"], CUSTODY),
  row("mcp.oauth.logout", ["4.4"], "removes MCP OAuth tokens"),
  row(
    "mcp.oauth.status",
    ["4.4"],
    "the MCP OAuth group of first-party design 4.5; held with login and logout by the design lane",
  ),
  row("threads.attach", ["4.1"], "attach and the answering of a pending dialog"),
  row("threads.extensions.sessionOps", ["4.1"], "an extension session operation"),
  row("threads.extensions.sessionCall", ["4.1"], "an extension session operation, run as the engine-resolved caller"),
  row(
    "threads.runToCompletion",
    ["4.4"],
    "its endpoint input and on_complete, which runs a command as the caller's user",
  ),
  row("toolkit.forSession", ["4.4"], "binds the loop operations to one loop session"),
  row("toolkit.addGoal", ["4.4"], LOOP),
  row("toolkit.checkpoint", ["4.4"], LOOP),
  row("toolkit.completeGoals", ["4.4"], LOOP),
  row("toolkit.createGoals", ["4.4"], LOOP),
  row("toolkit.criteria", ["4.4"], LOOP),
  row("toolkit.recordEvidence", ["4.4"], LOOP),
  row("toolkit.recordReviewBlockers", ["4.4"], LOOP),
  row("toolkit.status", ["4.4"], LOOP),
  row("toolkit.steer", ["4.4"], LOOP),
  field("threads.send", "author", ["4.1"], "a connector's identity; any other principal is refused"),
  field("threads.sendAndFollow", "author", ["4.1"], "a connector's identity; any other principal is refused"),
  field(
    "threads.create",
    "launch_spec",
    [],
    "not named by the security design; it selects which launch spec a host starts from, a launch option under the P1a scope line, and the design lane held it on 2026-11-25",
  ),
  field(
    "threads.extensions.register",
    "sessionCallable",
    ["4.1"],
    "declares the extension's session-callable operations",
  ),
  field("daemon.ensure", "launch_spec", ["4.4"], LAUNCH_SPEC),
  field("daemon.ensure", "mcp_presenter_enforcement", ["4.4"], "a presenter input"),
  field("daemon.handoff", "launch_spec", ["4.4"], LAUNCH_SPEC),
  field("install.plugin", "codex_autonomous", ["4.4"], "configures that platform's autonomous permissions"),
  field("engine.models.list", "setup", ["4.4"], "the launch setup of LaunchOptions (slice E1a-s)"),
  field("engine.promptSizes", "setup", ["4.4"], "the launch setup of LaunchOptions (slice E1a-s)"),
]
