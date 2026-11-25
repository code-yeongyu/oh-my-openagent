import { allow, columns, type MatrixLine, refuse } from "./types"

// Section 4.4 of the security design (#14945): the endpoint selector, launch options and the OpenCode edition.
const LAUNCH = [
  "engine.launch.interactive",
  "engine.launch.print",
  "engine.launch.rpc",
  "engine.launch.hand",
  "engine.launch.headless",
]
const DENY_OTHERS = { session: refuse(), connector: refuse(), service: refuse() }
const personOnly = (note?: string): MatrixLine["cells"] => columns({ people: allow(note), ...DENY_OTHERS })

export const LAUNCH_LINES: readonly MatrixLine[] = [
  {
    section: "4.4",
    capability:
      "The root's `endpoint` selector (`socket`, `key_root`) and the endpoint options (the same `socket` and `key_root`) of `daemon.ensure`, `stop`, `handoff`",
    slug: "endpoint",
    rows: ["daemon.ensure", "daemon.stop", "daemon.handoff"],
    root: { endpoint: { socket: "/run/omo-test/host.sock" } },
    cells: personOnly(
      "the selector names paths; the transport reads the credential under key_root and never returns it",
    ),
  },
  {
    section: "4.4",
    capability: "`engine.launch.interactive`, `print`, `rpc`, `hand`, `headless`",
    slug: "launch",
    rows: LAUNCH,
    cells: personOnly(),
  },
  {
    section: "4.4",
    capability: "`spawned_by` (ancestry) on a launch",
    slug: "spawned-by",
    rows: LAUNCH,
    input: { session: { spawned_by: { parentSessionId: "p1", rootSessionId: "r1", taskId: "t1" } } },
    cells: personOnly("only from the engine's own task host, which sets it today; any other caller is refused"),
  },
  {
    section: "4.4",
    capability: "`project_trust` on a launch or a package call",
    slug: "project-trust",
    rows: LAUNCH,
    input: { setup: { project_trust: true } },
    cells: personOnly("passed explicitly, never defaulted to trust"),
  },
  {
    section: "4.4",
    capability: "`project_trust` on a package call (`trust`)",
    docRow: "`project_trust` on a launch or a package call",
    slug: "project-trust",
    rows: ["engine.packages.install", "engine.packages.remove", "engine.packages.update"],
    input: { trust: true },
    cells: personOnly("passed explicitly, never defaulted to trust"),
  },
  {
    section: "4.4",
    capability:
      "The presenter inputs of `engine.launch.rpc` and of the host's ensure and handoff (`bootstrap_fd`, `enforcement`)",
    slug: "presenter",
    rows: ["engine.launch.rpc"],
    input: { presenter: { bootstrap_fd: 4, enforcement: true } },
    cells: personOnly("only from the launcher that starts a host today; unproven until the closed matrix cites it"),
  },
  {
    section: "4.4",
    capability: "The presenter inputs of the host's ensure (`mcp_presenter_enforcement`)",
    docRow:
      "The presenter inputs of `engine.launch.rpc` and of the host's ensure and handoff (`bootstrap_fd`, `enforcement`)",
    slug: "presenter",
    rows: ["daemon.ensure"],
    input: { mcp_presenter_enforcement: true },
    cells: personOnly("only from the launcher that starts a host today; unproven until the closed matrix cites it"),
  },
  {
    section: "4.4",
    capability:
      "`codex_autonomous` on `install.plugin`: `true` configures that platform's autonomous permissions, `false` leaves existing settings unchanged, absent takes the mode's default",
    slug: "codex-autonomous",
    rows: ["install.plugin"],
    input: { codex_autonomous: true },
    cells: personOnly(),
  },
  {
    section: "4.4",
    capability: "`toolkit.forSession({ cwd, session_id? })`: binding the loop operations to one loop session",
    slug: "for-session",
    rows: ["toolkit.forSession"],
    cells: columns({
      people: allow("for the session it names"),
      session: allow("only for its own session, with the id from the engine"),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.4",
    capability: "`toolkit.forSession` naming a session in its argument",
    docRow: "`toolkit.forSession({ cwd, session_id? })`: binding the loop operations to one loop session",
    slug: "for-session-named",
    rows: ["toolkit.forSession"],
    input: { session_id: "other-session" },
    cells: columns({
      people: allow("for the session it names"),
      session: refuse("sender_not_allowed", { note: "never from an argument" }),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.4",
    capability: "A provider API key as a launch input",
    slug: "api-key",
    rows: [],
    noRow:
      "a readable handle (LaunchKeyHandle); a JSON scenario cannot carry one, so P1b's driver supplies it for the launch rows' refusals above",
    cells: personOnly("through the carrier of 5.5"),
  },
  {
    section: "4.4",
    capability: "`threads.runToCompletion` (OpenCode edition)",
    slug: "run",
    rows: ["threads.runToCompletion"],
    cells: personOnly(),
  },
  {
    section: "4.4",
    capability: "`on_complete` on `runToCompletion`: runs a command as the caller's OS user",
    slug: "on-complete",
    rows: ["threads.runToCompletion"],
    input: { on_complete: { command: "true" } },
    cells: personOnly("runs a command as the caller's OS user"),
  },
  {
    section: "4.4",
    capability:
      "`install.plugin`, `install.cleanup`, `config.migrate`, `worktrees.sweep` with `apply`; `config.modelCapabilities.refresh` (it writes a cache and fetches from a URL the caller may supply)",
    slug: "opencode-change",
    rows: ["install.plugin", "install.cleanup", "config.migrate", "config.modelCapabilities.refresh"],
    cells: personOnly(),
  },
  {
    section: "4.4",
    capability: "`worktrees.sweep` with `apply`",
    docRow:
      "`install.plugin`, `install.cleanup`, `config.migrate`, `worktrees.sweep` with `apply`; `config.modelCapabilities.refresh` (it writes a cache and fetches from a URL the caller may supply)",
    slug: "sweep-apply",
    rows: ["worktrees.sweep"],
    input: { apply: true },
    cells: personOnly(),
  },
  {
    section: "4.4",
    capability: "`mcp.oauth.login`, `logout`; `account.keys.init`",
    slug: "opencode-credential",
    rows: ["mcp.oauth.login", "mcp.oauth.logout", "account.keys.init"],
    cells: personOnly(),
  },
  {
    section: "4.4",
    capability:
      "`mcp.oauth.status`, `account.keys.status`, `boulder.status`, `install.localVersion`, `worktrees.sweep` as a plan (reads)",
    slug: "opencode-read",
    rows: ["mcp.oauth.status", "account.keys.status", "boulder.status", "install.localVersion", "worktrees.sweep"],
    cells: columns({ people: allow(), session: allow("as an eval-cell read"), connector: refuse(), service: refuse() }),
  },
]
