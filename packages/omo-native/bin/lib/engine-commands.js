// The engine dispatches these one-shot commands on argv[0] before any session starts, so they must
// reach it with the command first; a leading `--extension` turns them into a chat launch (#9572).
// `app-server` is excluded on purpose: it reads the plugin after its subcommand. The list is checked
// against the installed engine's own dispatch by test/engine-commands.test.ts.
const ENGINE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config", "auth", "host", "schedule"])

export function isEngineCommand(args) {
  const command = args[0]
  if (command === undefined) return false
  if (ENGINE_COMMANDS.has(command)) return true
  return command === "models" && args[1] === "discover"
}
