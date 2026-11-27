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
}

// The loop's brief parser, driven directly: the flags it accepts and ignores must keep their value out of the brief
// (amendment 2, D7), so a flag that starts to mean something changes this outcome.
export type LoopParseScenario = {
  readonly id: string
  readonly capability: string
  readonly surface: "loop-parse"
  readonly argv: readonly string[]
}

// The shipped SDK, driven in a child process against the tree's own code: the fixture files written under a sandbox
// home (and its project directory, the call's cwd), one call of the member, its answer normalized.
export type SdkScenario = {
  readonly id: string
  readonly capability: string
  readonly surface: "sdk"
  readonly member: string
  // Paths relative to the sandbox home; "project/..." lands in the project directory the call runs in.
  readonly files: Readonly<Record<string, string>>
}

export type Scenario = CliScenario | ToolScenario | LoopParseScenario | SdkScenario

// What each runner consumes to make its call. A field outside it (the usage block a CLI scenario names) only states an
// expectation and may change; the call itself may not, for an unresolved capability (gate.ts).
export function callPart(scenario: Scenario): Readonly<Record<string, unknown>> {
  switch (scenario.surface) {
    case "native":
    case "opencode":
    case "loop-parse":
      return { surface: scenario.surface, capability: scenario.capability, argv: scenario.argv }
    case "tool":
      return { surface: scenario.surface, capability: scenario.capability, tool: scenario.tool, args: scenario.args }
    case "sdk":
      return {
        surface: scenario.surface,
        capability: scenario.capability,
        member: scenario.member,
        files: scenario.files,
      }
  }
}

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
  {
    id: "sdk-config-status-diagnostics",
    capability: "config.status",
    surface: "sdk",
    member: "config.status",
    files: {
      ".omo/omo.jsonc": JSON.stringify({
        zz_fixture_unknown_key: 1,
        task: { host_engine_policy: "fixture-not-a-policy", zz_fixture_nested_key: true },
      }),
      "project/.omo/omo.jsonc": '{ "zz_fixture_parse": ',
    },
  },
]
