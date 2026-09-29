import { join } from "node:path"

/**
 * How the compiled binary reads its own argv before it hands the argv to the engine. Only the
 * options before `--` are the launch's; everything after `--` is message text (senpi's parser puts
 * it into `messages`), so no scan here may treat a message as a flag. `omo daemon adopt` depends
 * on this: it replays the user's queued messages after `--`, and a message that reads
 * `--no-extensions` must not start the adopted session without the plugin.
 */

export const earlyCommands = new Set(["install", "remove", "list", "config", "auth", "app-server", "host"])

export function launchOptions(args: readonly string[]): readonly string[] {
  const end = args.indexOf("--")
  return end === -1 ? args : args.slice(0, end)
}

export function buildSenpiArgs(args: string[], execDir: string): string[] {
  const command = args[0]
  const ownsExtensions = launchOptions(args).includes("--no-extensions")
  // Same placement as the launcher: app-server only reads --extension after its subcommand.
  if (command === "app-server") return ownsExtensions ? args : [...args, "--extension", join(execDir, "plugin")]
  if (earlyCommands.has(command) || command === "update") return args
  // `--no-extensions` is the caller owning the extension list: a memory child lists none and an
  // RPC task child lists this plugin itself, so injecting it here would load the plugin into a
  // bare child or load it twice.
  if (ownsExtensions) return args
  return ["--extension", join(execDir, "plugin"), ...args]
}

export function shouldPrintCompiledBanner(args: string[], stderrIsTTY: boolean): boolean {
  if (!stderrIsTTY) return false
  const options = launchOptions(args)
  if (options.includes("-p") || options.includes("--print") || options.includes("--mode")) return false
  const command = args[0]
  if (command === undefined) return true
  if (earlyCommands.has(command)) return false
  if (command === "update" || command === "doctor" || command === "setup" || command === "ulw-loop") return false
  if (command === "--version" || command === "-v") return false
  return true
}
