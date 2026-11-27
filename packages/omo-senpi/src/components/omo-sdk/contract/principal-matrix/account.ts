import { allow, columns, type MatrixLine, NA, refuse } from "./types"

// Section 4.2 of the security design (#14945): devices, account, device service, sync.
const CREDENTIAL_CHECK = "once its output is shown to hold no credential"

export const ACCOUNT_LINES: readonly MatrixLine[] = [
  {
    section: "4.2",
    capability: "`devices.list`, `account.whoami`, `sync.status` (reads)",
    docRow: "`devices.list`, `account.whoami`, `deviceService.status`, `control()`, `wake()`, `sync.status` (reads)",
    slug: "account-read",
    rows: ["devices.list", "account.whoami", "sync.status"],
    cells: columns({
      people: allow(),
      session: allow(`through the SDK in an eval cell; sync.status ${CREDENTIAL_CHECK}`),
      connector: refuse("sender_not_allowed", { note: "new" }),
      service: refuse("sender_not_allowed", { note: "the service column allows the service reads only" }),
    }),
  },
  {
    section: "4.2",
    capability: "`deviceService.status`, `control()`, `wake()` (reads)",
    docRow: "`devices.list`, `account.whoami`, `deviceService.status`, `control()`, `wake()`, `sync.status` (reads)",
    slug: "service-read",
    rows: ["deviceService.status", "deviceService.info", "deviceService.control", "deviceService.wake"],
    cells: columns({ people: allow(), session: allow(CREDENTIAL_CHECK), connector: allow(), service: allow() }),
  },
  {
    section: "4.2",
    capability: "`deviceService.setEnabled`, `setControl`, `setWake`",
    slug: "service-switch",
    rows: ["deviceService.enable", "deviceService.disable", "deviceService.setControl", "deviceService.setWake"],
    cells: columns({
      people: allow("a script through the person client (section 3); R/client.ts refuses a cli sender on the wire"),
      session: refuse("sender_not_allowed", { note: "not a person" }),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.2",
    capability: "`deviceService.bootstrap`",
    slug: "bootstrap",
    rows: ["deviceService.bootstrap"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: allow() }),
  },
  {
    section: "4.2",
    capability: "`devices.rename`",
    slug: "rename",
    rows: ["devices.rename"],
    cells: columns({ people: allow(), session: allow("as shipped"), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.2",
    capability:
      "`devices.revoke` (never this device; an ambiguous name or prefix revokes nothing; the name as confirmation)",
    slug: "revoke",
    rows: ["devices.revoke"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.2",
    capability: "`account.signIn`",
    slug: "sign-in",
    rows: ["account.signIn"],
    cells: columns({
      people: allow(),
      session: allow("where the shipped SDK allows it: the codes reach a callback a person reads"),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.2",
    capability: "`account.signIn` with `replace`",
    docRow: "`account.signIn`",
    slug: "sign-in-replace",
    rows: ["account.signIn"],
    input: { replace: true },
    cells: columns({
      people: allow(),
      session: refuse("sender_not_allowed", { change: "B4" }),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.2",
    capability: "The account service origin on any account call",
    slug: "origin",
    rows: ["account.signIn", "account.whoami"],
    root: { api: "https://api.example.test" },
    cells: columns({
      people: allow("as today: the caller supplies it"),
      session: refuse("sender_not_allowed", { note: "a session's call uses the configured origin" }),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.2",
    capability: "`account.signOut`, `account.forget`",
    slug: "sign-out",
    rows: ["account.signOut", "account.forget"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.2",
    capability:
      "`account.adopt`, `account.credentials.handOver`, `account.store.*`, `account.keys.*` except `account.keys.status` (4.4: it reports state and no key material)",
    slug: "custody",
    rows: [
      "account.adopt",
      "account.credentials.handOver",
      "account.store.status",
      "account.store.enable",
      "account.store.disable",
      "account.keys.init",
    ],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.2",
    capability: "`sync.enable`, `sync.recover`",
    slug: "phrase",
    rows: ["sync.enable", "sync.recover"],
    cells: columns({
      people: allow(
        "only where the terminal check of 5.2 admits the terminal; otherwise refused before anything secret exists",
      ),
      session: refuse(),
      connector: refuse(),
      service: refuse(),
    }),
  },
  {
    section: "4.2",
    capability: "`sync.approve`, `sync.disable`, `sync.retirePin`",
    slug: "sync-change",
    rows: ["sync.approve", "sync.disable", "sync.retirePin"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.2",
    capability: "`account.audit.list` (8.2)",
    slug: "audit-list",
    rows: [],
    noRow: "the registry has no row for it yet; the slice that adds the custody log adds the row and the call",
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.2",
    capability: "Changing the peer allowlist or the named principals for credential return",
    slug: "peer-allowlist",
    rows: [],
    noRow: "no call exists and none may: the list ships with the build and no caller enrols a peer",
    cells: columns({ people: refuse(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.2",
    capability: "Any account call under a desktop launch",
    slug: "desktop-launch",
    rows: [],
    noRow: "a launch condition, not a principal: every account call answers desktop_sign_in under a desktop launch",
    cells: columns({
      people: refuse("desktop_sign_in"),
      session: refuse("desktop_sign_in"),
      connector: refuse(),
      service: NA,
    }),
  },
]
