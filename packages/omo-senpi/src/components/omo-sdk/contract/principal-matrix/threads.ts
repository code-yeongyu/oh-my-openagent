import { allow, columns, type MatrixLine, NA, refuse } from "./types"

// Section 4.1 of the security design (#14945): threads.
const READS = ["threads.list", "threads.read", "threads.entries", "threads.get", "threads.wait", "threads.follow"]
const CONTROL = [
  "threads.interrupt",
  "threads.close",
  "threads.setModel",
  "threads.setReasoning",
  "threads.rename",
  "threads.archive",
  "threads.handoff",
]
const SEND = ["threads.send", "threads.sendAndFollow"]
const AUTHOR = { platform_user_id: "u1", display: "Ada" }
const UNSUPPORTED_CONNECTOR = refuse("unsupported", { note: "connector_send: a connector client cannot send yet" })

export const THREAD_LINES: readonly MatrixLine[] = [
  {
    section: "4.1",
    capability: "List, read, entries, get, wait, follow",
    slug: "read",
    rows: READS,
    cells: columns({
      people: allow(),
      session: allow("the workspace is the default scope and not a boundary"),
      connector: refuse("sender_not_allowed", { change: "B5" }),
      service: refuse("sender_not_allowed", { note: "unreachable today" }),
    }),
  },
  {
    section: "4.1",
    capability: "Read a delivery receipt",
    slug: "receipt",
    rows: ["threads.receipt"],
    cells: columns({
      people: allow("own deliveries only"),
      session: allow("own deliveries only"),
      connector: allow("own deliveries only"),
      service: NA,
    }),
  },
  {
    section: "4.1",
    capability: "`self` as an address",
    slug: "self-address",
    rows: ["threads.read"],
    input: { thread: "self" },
    cells: columns({
      people: refuse("caller_context_missing"),
      session: allow(),
      connector: refuse("caller_context_missing"),
      service: NA,
    }),
  },
  {
    section: "4.1",
    capability:
      "A send that is a reply: resolves only to the sender of the delivery it answers, by exact id or stated name, pinned to that sender's device; the reply grant widens only a scope refusal and only to that sender",
    slug: "reply",
    rows: ["threads.send"],
    cells: columns({ people: NA, session: allow(), connector: NA, service: NA }),
  },
  {
    section: "4.1",
    capability: "Fuzzy matching of a target",
    slug: "fuzzy-target",
    rows: ["threads.handoff"],
    input: { thread: "stud" },
    cells: columns({
      people: refuse("not_found", { note: "exact matching only" }),
      session: allow("for handoff only"),
      connector: refuse("not_found", { note: "exact matching only" }),
      service: NA,
    }),
  },
  {
    section: "4.1",
    capability: "Send to a session on this device",
    slug: "send-this-device",
    rows: SEND,
    input: { thread: "studio" },
    cells: {
      person: refuse("unsupported", { note: "a person's own prompt goes through the terminal" }),
      script: allow("as cli:<uid>, a delivery"),
      session: allow(),
      connector: UNSUPPORTED_CONNECTOR,
      service: refuse("sender_not_allowed"),
    },
    split: "a person's own prompt is R `unsupported` on the gateway leg and goes through the terminal",
  },
  {
    section: "4.1",
    capability: "Send to a session on another device",
    slug: "send-another-device",
    rows: SEND,
    input: { thread: "laptop/studio" },
    cells: columns({
      people: allow(
        "the person's prompt; a script takes the person leg (section 3); a cli sender is refused on the relay",
      ),
      session: allow("as a delivery"),
      connector: UNSUPPORTED_CONNECTOR,
      service: refuse("sender_not_allowed"),
    }),
  },
  {
    section: "4.1",
    capability: "A message to a session on the caller's own device through the remote client",
    slug: "remote-client-own-device",
    rows: [],
    noRow: "the remote client's sessions.send, not a root call: the root sends on this device through the thread core",
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.1",
    capability: "`author` on a send",
    slug: "author",
    rows: SEND,
    input: { author: AUTHOR },
    cells: columns({
      people: refuse("invalid_arguments"),
      session: refuse("invalid_arguments"),
      connector: allow(),
      service: NA,
    }),
  },
  {
    section: "4.1",
    capability: "Create or open a thread",
    slug: "create",
    rows: ["threads.create"],
    cells: columns({
      people: allow("in the approval mode it names"),
      session: allow("keeping or narrowing its own mode"),
      connector: allow("keeping or narrowing its own mode"),
      service: refuse(),
    }),
  },
  {
    section: "4.1",
    capability: "Create or open a thread, wider than the caller's own approval mode",
    docRow: "Create or open a thread",
    slug: "create-wider-mode",
    rows: ["threads.create"],
    input: { permission_preset: "full-access" },
    cells: columns({
      people: allow("in the approval mode it names"),
      session: refuse("scope_denied", { note: "permission_preset_wider" }),
      connector: refuse("scope_denied", { note: "permission_preset_wider" }),
      service: refuse(),
    }),
  },
  {
    section: "4.1",
    capability: "Interrupt, close, set model, set reasoning, rename, archive, handoff",
    slug: "control",
    rows: CONTROL,
    cells: columns({
      people: allow(),
      session: allow("on any thread the session can address"),
      connector: refuse("sender_not_allowed", { change: "B5" }),
      service: refuse("sender_not_allowed", { note: "unreachable today" }),
    }),
  },
  {
    section: "4.1",
    capability: "Unload",
    slug: "unload",
    rows: ["threads.unload"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.1",
    capability: "Attach and answer a pending dialog",
    slug: "attach",
    rows: ["threads.attach"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.1",
    capability: "Registering a store extension, calling one of its operations",
    slug: "extension",
    rows: ["threads.extensions.register", "threads.extensions.call"],
    cells: columns({ people: allow(), session: refuse(), connector: refuse(), service: refuse() }),
  },
  {
    section: "4.1",
    capability: "A store extension's session-callable operation (`sessionOps`, `sessionCall`)",
    slug: "session-op",
    rows: ["threads.extensions.sessionOps", "threads.extensions.sessionCall"],
    cells: columns({
      people: refuse("caller_context_missing", { note: "the caller is the one the engine resolved" }),
      session: allow("only as itself"),
      connector: refuse("caller_context_missing"),
      service: refuse("caller_context_missing"),
    }),
  },
  {
    section: "4.1",
    capability: "A parked session's intake",
    slug: "parked-intake",
    rows: [],
    noRow: "the store worker's intake, not a root call",
    cells: columns({ people: NA, session: allow(), connector: refuse(), service: refuse() }),
  },
]
