import { join } from "node:path"

import { isEngineCommand } from "./bin/lib/engine-commands.js"
import { isSelfUpdate, updateUsageAnswer } from "./bin/lib/update-args.js"
import { serviceAccountsOpen } from "../omo-opencode/src/cli/service-auth/accounts-gate"

/**
 * How the compiled binary reads its own argv before it hands the argv to the engine. Only the
 * options before `--` are the launch's; everything after `--` is message text (senpi's parser puts
 * it into `messages`), so no scan here may treat a message as a flag. `omo daemon adopt` depends
 * on this: it replays the user's queued messages after `--`, and a message that reads
 * `--no-extensions` must not start the adopted session without the plugin.
 */


export function launchOptions(args: readonly string[]): readonly string[] {
  const end = args.indexOf("--")
  return end === -1 ? args : args.slice(0, end)
}

/** Design 6.1: unknown argv remains long-lived; message text after -- is never a flag. */
export function trustLaunchKind(args: readonly string[]): "static" | "long-lived" | "short-host-cli" | "one-shot-network" {
  if (args.length === 1 && ["--version", "-v", "--help"].includes(args[0] ?? "")) return "static"
  if (isSelfUpdate(args) && updateUsageAnswer(args) !== undefined) return "static"
  // While accounts are closed, every login/logout/whoami argv refuses from the build switch alone and
  // opens no connection: a static answer, the way update usage is static beside the network `update`.
  if (!serviceAccountsOpen() && ["login", "logout", "whoami"].includes(args[0] ?? "")) return "static"
  const options = launchOptions(args)
  if (["thread", "daemon"].includes(options[0] ?? "")
    || (options[0] === "host" && ["ensure", "status", "stop", "handoff"].includes(options[1] ?? ""))) return "short-host-cli"
  if (["login", "logout", "whoami", "sync", "account", "update", "doctor", "setup"].includes(options[0] ?? "")
    || options.includes("-p") || options.includes("--print")
    || options.some((arg, index) => arg === "--mode" && options[index + 1] === "json")) return "one-shot-network"
  return "long-lived"
}

export function buildSenpiArgs(args: string[], execDir: string): string[] {
  const ownsExtensions = launchOptions(args).includes("--no-extensions")
  if (isEngineCommand(args)) return args
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
  if (isEngineCommand(args)) return false
  if (command === "update" || command === "doctor" || command === "setup" || command === "ulw-loop") return false
  if (command === "--version" || command === "-v") return false
  return true
}
