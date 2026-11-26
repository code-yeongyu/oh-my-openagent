import { allRows, loadDomainFiles } from "./registry"
import type { Row } from "./schema"

// The scenarios the changed-capability gate drives on the merge base and on the head (design 7.4): each names the
// capability whose outcome it shows and the surface it goes through. They stop at parsing, usage refusals and the tools'
// own refusals, so no scenario reaches the network, an account, a model or a real engine host.

export type CliScenario = {
  readonly id: string
  readonly capability: string
  readonly surface: "native" | "opencode"
  readonly argv: readonly string[]
  // The command whose `usage: omo <command>` block the output carries; only that block can take a presentation-only
  // change (presentation.ts).
  readonly usage?: string
}

export type ToolScenario = {
  readonly id: string
  readonly capability: string
  readonly surface: "tool"
  readonly tool: string
  readonly args: Readonly<Record<string, unknown>>
  // Generated from a row's declared aliases (#15073): `twin` names the scenario with the field itself, which this one
  // must answer exactly like; `conflict` marks the alias given with its field and a different value, which is refused.
  readonly alias?: { readonly row: string; readonly twin?: string; readonly conflict?: boolean }
}

// The loop's brief parser, driven directly: the flags it accepts and ignores must keep their value out of the brief
// (amendment 2, D7), so a flag that starts to mean something changes this outcome.
export type LoopParseScenario = {
  readonly id: string
  readonly capability: string
  readonly surface: "loop-parse"
  readonly argv: readonly string[]
}

export type Scenario = CliScenario | ToolScenario | LoopParseScenario

const native = (id: string, capability: string, argv: readonly string[], usage?: string): CliScenario => ({
  id,
  capability,
  surface: "native",
  argv,
  ...(usage === undefined ? {} : { usage }),
})
const opencode = (id: string, capability: string, argv: readonly string[]): CliScenario => ({
  id,
  capability,
  surface: "opencode",
  argv,
})
const tool = (id: string, capability: string, name: string, args: Record<string, unknown>): ToolScenario => ({
  id,
  capability,
  surface: "tool",
  tool: name,
  args,
})

const ALIAS_BASE_ARGS: Readonly<Record<string, Record<string, unknown>>> = {
  thread_read: { thread: "missing-thread" },
  thread_list: {},
  thread_create: { thread: "missing-thread" },
  thread_send: { thread: "missing-thread", message: "hi" },
  thread_handoff: { thread: "missing-thread", message: "hi" },
  thread_rename: { thread: "missing-thread" },
}
const ALIAS_VALUES: Readonly<Record<string, readonly [unknown, unknown]>> = {
  limit: [3, 4],
  max_bytes: [4096, 8192],
  query: ["qa", "zz"],
  prompt: ["hi", "yo"],
  name: ["n1", "n2"],
  delivery: ["follow_up", "steer"],
  reasoning: ["high", "low"],
}

// Three scenarios per declared alias, once per tool: the alias alone, its field alone (the twin), and both disagreeing.
export function aliasScenarios(rows: readonly Row[]): ToolScenario[] {
  const seen = new Set<string>()
  const out: ToolScenario[] = []
  for (const row of rows)
    for (const entry of row.tool)
      for (const [alias, field] of Object.entries(entry.aliases ?? {})) {
        const id = `alias-${entry.name}-${alias}`
        const values = ALIAS_VALUES[field]
        if (seen.has(id) || values === undefined) continue
        seen.add(id)
        const args = ALIAS_BASE_ARGS[entry.name] ?? {}
        const [value, other] = values
        out.push(
          { ...tool(`${id}-field`, row.id, entry.name, { ...args, [field]: value }), alias: { row: row.id } },
          { ...tool(id, row.id, entry.name, { ...args, [alias]: value }), alias: { row: row.id, twin: `${id}-field` } },
          {
            ...tool(`${id}-conflict`, row.id, entry.name, { ...args, [alias]: value, [field]: other }),
            alias: { row: row.id, conflict: true },
          },
        )
      }
  return out
}

export const SCENARIOS: readonly Scenario[] = [
  native("native-thread-usage", "threads.list", ["thread"]),
  native("native-thread-help", "threads.list", ["thread", "--help"]),
  native("native-thread-list-bad-state", "threads.list", ["thread", "list", "--state", "bogus"]),
  native("native-thread-send-arity", "threads.send", ["thread", "send", "x"]),
  native("native-daemon-help", "daemon.run", ["daemon", "--help"]),
  native("native-daemon-attach-retired", "retired.daemon-attach", ["daemon", "attach"]),
  native("native-daemon-foreground-retired", "retired.daemon-run-foreground", ["daemon", "run", "--foreground"]),
  native("native-remote-help", "deviceService.status", ["remote", "help"], "remote"),
  native("native-remote-unknown", "deviceService.status", ["remote", "bogus"], "remote"),
  native("native-remote-open-no-device", "threads.create", ["remote", "open"], "remote"),
  native("native-update-all-refused", "install.update", ["update", "--all"]),
  native("native-update-unknown-flag", "install.update", ["update", "--bogus"]),
  native("native-account-usage", "account.show", ["account"]),
  native("native-account-unknown", "account.show", ["account", "bogus"]),
  native("native-account-devices-unknown", "devices.revoke", ["account", "devices", "bogus"]),
  native("native-sign-in-check", "account.signInCheck", ["account", "sign-in", "--check"]),
  native("native-sync-help", "sync.status", ["sync", "--help"]),
  native("native-app-server-retired", "retired.app-server", ["app-server"]),
  native("native-ulw-loop-retired", "retired.native-ulw-loop", ["ulw-loop"]),
  native("native-version", "install.version", ["--version"]),
  opencode("opencode-help", "render.help", ["--help"]),
  opencode("opencode-install-help", "install.plugin", ["install", "--help"]),
  opencode("opencode-run-help", "threads.runToCompletion", ["run", "--help"]),
  opencode("opencode-doctor-help", "diagnostics.run", ["doctor", "--help"]),
  opencode("opencode-boulder-help", "boulder.status", ["boulder", "--help"]),
  opencode("opencode-sweep-bad-age", "worktrees.sweep", ["worktree-sweep", "--older-than", "x"]),
  opencode("opencode-mcp-oauth-help", "mcp.oauth.status", ["mcp", "oauth", "--help"]),
  opencode("opencode-config-migrate-help", "config.migrate", ["config", "migrate", "--help"]),
  opencode("opencode-version", "install.version", ["version"]),
  opencode("opencode-local-version-help", "install.localVersion", ["get-local-version", "--help"]),
  opencode("opencode-cleanup-help", "install.cleanup", ["cleanup", "--help"]),
  opencode("opencode-login-help", "account.signIn", ["login", "--help"]),
  opencode("opencode-account-keys-help", "account.keys.status", ["account", "keys", "--help"]),
  {
    id: "loop-brief-skips-ignored-flags",
    capability: "toolkit.createGoals",
    surface: "loop-parse",
    argv: [
      "create-goals",
      "--after-json",
      "A",
      "--directive-json",
      "B",
      "--directive-file",
      "C",
      "--target-goal-id",
      "D",
      "ship",
      "it",
    ],
  },
  tool("tool-list-empty", "threads.list", "thread_list", {}),
  tool("tool-read-missing", "threads.read", "thread_read", { thread: "missing-thread" }),
  tool("tool-receipt-missing", "threads.receipt", "thread_read", { thread: "missing-thread", delivery_id: "d1" }),
  tool("tool-send-missing", "threads.send", "thread_send", { thread: "missing-thread", message: "hi" }),
  tool("tool-interrupt-missing", "threads.interrupt", "thread_interrupt", { thread: "missing-thread" }),
  tool("tool-close-missing", "threads.close", "thread_close", { thread: "missing-thread" }),
  tool("tool-rename-missing", "threads.rename", "thread_rename", { thread: "missing-thread", name: "n" }),
  tool("tool-set-model-missing", "threads.setModel", "thread_set_model", { thread: "missing-thread", model: "m" }),
  tool("tool-set-reasoning-missing", "threads.setReasoning", "thread_set_reasoning", {
    thread: "missing-thread",
    level: "high",
  }),
  tool("tool-archive-missing", "threads.archive", "thread_archive", { thread: "missing-thread" }),
  tool("tool-handoff-missing", "threads.handoff", "thread_handoff", { thread: "missing-thread", message: "hi" }),
  ...aliasScenarios(allRows(loadDomainFiles())),
]
