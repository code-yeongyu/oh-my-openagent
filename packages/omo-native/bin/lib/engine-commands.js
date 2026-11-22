// The engine dispatches these one-shot commands on argv[0] before any session starts, so they must
// reach it with the command first; a leading `--extension` turns them into a chat launch (#9572).
// The list is checked against the installed engine's own dispatch by test/engine-commands.test.ts.
import { join } from "node:path"

const ENGINE_COMMANDS = new Set([
  "install",
  "remove",
  "uninstall",
  "update",
  "list",
  "config",
  "auth",
  "host",
  "schedule",
  // omo#14253: senpi answers `session-of-pid <pid> --json` itself (one JSON line, its own usage errors).
  "session-of-pid",
])

export function isEngineCommand(args) {
  const command = args[0]
  if (command === undefined) return false
  if (ENGINE_COMMANDS.has(command)) return true
  return command === "models" && args[1] === "discover"
}

// The host subcommands that START a host. Without `--launch-spec` the engine starts a bare host that never
// loads the omo plugin, and every client that later reuses it inherits that (#10643). compile-args.ts applies
// the same rule to the compiled entry.
function startsHost(args) {
  if (args[0] !== "host") return false
  return args[1] === "ensure" || args[1] === "handoff" || (args[1] === "session" && args[2] === "open")
}

/** The engine argv for a one-shot command: unchanged, except that a host start without a spec gets this package's own. */
export function engineCommandArgs(args, pluginRoot) {
  if (!startsHost(args)) return args
  if (args.some((arg) => arg === "--launch-spec" || arg.startsWith("--launch-spec="))) return args
  return [...args, "--launch-spec", join(pluginRoot, "daemon-launch-spec.json")]
}
