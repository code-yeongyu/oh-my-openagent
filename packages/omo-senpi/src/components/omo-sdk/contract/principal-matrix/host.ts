import { allow, columns, type MatrixLine, NA, refuse } from "./types"

// Section 4.3 of the security design (#14945): daemon, diagnostics, install, engine, MCP.
const SCANNED = "as an eval-cell read, once a canary scan shows its output cannot carry a credential"

export const HOST_LINES: readonly MatrixLine[] = [
  {
    section: "4.3",
    capability:
      "`daemon.status`, `diagnostics.run`, `install.version`, `config.status`, `engine.schedule.list`, `engine.models.list`, `engine.packages.list` (reads)",
    slug: "host-read",
    rows: [
      "daemon.status",
      "diagnostics.run",
      "install.version",
      "config.status",
      "engine.schedule.list",
      "engine.models.list",
      "engine.packages.list",
    ],
    cells: columns({ people: allow(), session: allow(SCANNED), connector: refuse(), service: NA }),
  },
  {
    section: "4.3",
    capability:
      "`daemon.ensure`, `stop`, `stopAll`, `handoff`, `gc`, `rollbackPrepare`; `diagnostics.fixReflectionLock`, `reapStaleEngines`; `install.update`, `setup.apply`, `cleanup`; `install.setup.detect` and `setup.plan`, which read what a setup would import, a pending provider key among it, though they print none; `engine.trust.ensure` (it writes the trust store and can take a lease for another process)",
    slug: "host-change",
    rows: [
      "daemon.ensure",
      "daemon.stop",
      "daemon.stopAll",
      "daemon.handoff",
      "daemon.gc",
      "daemon.rollbackPrepare",
      "diagnostics.fixReflectionLock",
      "diagnostics.reapStaleEngines",
      "install.update",
      "install.setup.apply",
      "install.cleanup",
      "install.setup.detect",
      "install.setup.plan",
      "engine.trust.ensure",
    ],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.3",
    capability: "`engine.packages.install`, `remove`, `update`; `engine.config.setResource`",
    slug: "packages",
    rows: ["engine.packages.install", "engine.packages.remove", "engine.packages.update", "engine.config.setResource"],
    cells: columns({
      people: allow("with the project-trust choice passed explicitly"),
      session: refuse(),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.3",
    capability: "`engine.auth.check` without credentials",
    slug: "auth-check",
    rows: ["engine.auth.check"],
    cells: columns({
      people: allow(),
      session: allow("status only, with the refresh forced off (B6)"),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.3",
    capability: "`engine.models.discover`",
    slug: "discover",
    rows: ["engine.models.discover"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.3",
    capability: "`engine.auth.apiKey`, `bearerToken`, `check` with credentials; `mcp.oauth.login`, `logout`",
    slug: "credential",
    rows: [
      "engine.auth.apiKey",
      "engine.auth.bearerToken",
      "engine.auth.credentials",
      "mcp.oauth.login",
      "mcp.oauth.logout",
    ],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.3",
    capability: "`engine.schedule.cancel`, `run`",
    slug: "schedule",
    rows: ["engine.schedule.cancel", "engine.schedule.run"],
    cells: columns({
      people: allow(),
      session: refuse("sender_not_allowed", { note: "a session schedules through the engine's own tool" }),
      connector: refuse(),
      service: refuse(),
    }),
  },
]
