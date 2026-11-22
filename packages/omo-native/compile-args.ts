import { existsSync } from "node:fs"
import { join } from "node:path"

import { isEngineCommand } from "./bin/lib/engine-commands.js"
import { LAUNCH_SPEC_FILENAME } from "./bin/lib/launch-spec-mode.js"
import { isSelfUpdate, updateUsageAnswer } from "./bin/lib/update-args.js"
import { serviceAccountsOpen } from "../omo-opencode/src/cli/service-auth/accounts-gate"
import {
  parsesAsBareClosedLogin,
  parsesAsClosedDeviceLogin,
} from "../omo-opencode/src/cli/service-auth/closed-device-login"

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
export function trustLaunchKind(
  args: readonly string[],
): "static" | "long-lived" | "short-host-cli" | "one-shot-network" | "local-only" {
  if (args.length === 1 && ["--version", "-v", "--help"].includes(args[0] ?? "")) return "static"
  if (isSelfUpdate(args) && updateUsageAnswer(args) !== undefined) return "static"
  // While accounts are closed, a login argv that is neither the device form nor the bare form (#13265) refuses from
  // the build switch alone and opens no connection: a static answer, the way update usage is static beside the network
  // `update`. #12639: the device-code login is the one closed sign-in that runs (service-auth/commands.ts). #12646: it
  // is recognised with the same option parse commands.ts uses, so `login -- --device` stays a static refusal here too.
  // #13265: bare `login` runs the device flow behind the attach refusal, and logout/whoami run as one-shot commands.
  const deviceLogin = parsesAsClosedDeviceLogin(args)
  const bareLogin = parsesAsBareClosedLogin(args)
  if (!serviceAccountsOpen() && args[0] === "login" && !deviceLogin && !bareLogin) return "static"
  const options = launchOptions(args)
  // 5.2: `trust ensure` imports with 1.5 s and exits; only `--wait` takes the one-shot hard cap.
  if (options[0] === "trust") return options.includes("--wait") ? "one-shot-network" : "short-host-cli"
  if (
    ["thread", "daemon"].includes(options[0] ?? "") ||
    (options[0] === "host" && ["ensure", "status", "stop", "handoff"].includes(options[1] ?? ""))
  )
    return "short-host-cli"
  if (
    ["login", "logout", "whoami", "sync", "account", "update", "doctor", "setup"].includes(options[0] ?? "") ||
    options.includes("-p") ||
    options.includes("--print") ||
    options.some((arg, index) => arg === "--mode" && options[index + 1] === "json")
  )
    return "one-shot-network"
  return "long-lived"
}

/**
 * The shared host child the engine's supervisor spawns (`--mode rpc --multi-session --listen` plus its launch spec's
 * `--session-runtime` and `--extension` paths; a spec listing no extensions gives only the former) already names
 * everything it loads, and the engine identifies it by exactly that list
 * (`runtimeBuildId`, `launch_profile`), while `host ensure` predicts the id (`clientRuntimeBuildId`) from the spec
 * alone. Prepending the plugin here made one binary report two ids whenever the spec's plugin was not this runtime's
 * own folder (a user-owned copy, a discovered plugin): the desktop judged the host `build_mismatch` and every
 * handover's successor exited. The desktop's packaged entry applies the same rule.
 */
function carriesLaunchProfile(options: readonly string[]): boolean {
  const mode = options.indexOf("--mode")
  return (
    mode !== -1 &&
    options[mode + 1] === "rpc" &&
    options.includes("--multi-session") &&
    options.includes("--listen") &&
    (options.includes("--extension") || options.includes("--session-runtime"))
  )
}

function startsHost(options: readonly string[]): boolean {
  if (options[0] !== "host") return false
  return options[1] === "ensure" || options[1] === "handoff" || (options[1] === "session" && options[2] === "open")
}

/**
 * A host this runtime starts loads its plugin through this runtime's own launch spec, as `omo daemon` already passes
 * it. Without one the engine predicts a host with no extensions while the host child, re-entering this wrapper,
 * would load the plugin, so the two runtime ids could never agree.
 */
function withOwnLaunchSpec(args: string[], execDir: string): string[] {
  const options = launchOptions(args)
  if (!startsHost(options)) return args
  if (options.some((arg) => arg === "--launch-spec" || arg.startsWith("--launch-spec="))) return args
  const spec = join(execDir, "plugin", LAUNCH_SPEC_FILENAME)
  if (!existsSync(spec)) return args
  return [...options, "--launch-spec", spec, ...args.slice(options.length)]
}

export function buildSenpiArgs(args: string[], execDir: string): string[] {
  const options = launchOptions(args)
  if (isEngineCommand(args)) return withOwnLaunchSpec(args, execDir)
  // `--no-extensions` is the caller owning the extension list: a memory child lists none and an
  // RPC task child lists this plugin itself, so injecting it here would load the plugin into a
  // bare child or load it twice.
  if (options.includes("--no-extensions") || carriesLaunchProfile(options)) return args
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
