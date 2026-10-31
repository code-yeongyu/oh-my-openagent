// The engine dispatches these one-shot commands on argv[0] before any session starts, so they must
// reach it with the command first; a leading `--extension` turns them into a chat launch (#9572).
// The list is checked against the installed engine's own dispatch by test/engine-commands.test.ts.
import { join } from "node:path"

const ENGINE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config", "auth", "host", "schedule"])

// The two host subcommands that START a host. Without `--launch-spec` the engine starts a bare host
// that never loads the omo plugin, and every client that later reuses it inherits that (#10643).
const HOST_STARTING_SUBCOMMANDS = new Set(["ensure", "handoff"])

export function isEngineCommand(args) {
  const command = args[0]
  if (command === undefined) return false
  if (ENGINE_COMMANDS.has(command)) return true
  return command === "models" && args[1] === "discover"
}

/**
 * The engine argv for a one-shot command: unchanged, except that `host ensure` / `host handoff`
 * without an explicit `--launch-spec` get this package's own plugin spec, so an omo host always
 * carries the omo plugin, as `omo daemon run` and `omo --mode rpc` do.
 */
export function engineCommandArgs(args, pluginRoot) {
  if (args[0] !== "host" || !HOST_STARTING_SUBCOMMANDS.has(args[1]) || args.includes("--launch-spec")) return args
  return [...args, "--launch-spec", join(pluginRoot, "daemon-launch-spec.json")]
}
