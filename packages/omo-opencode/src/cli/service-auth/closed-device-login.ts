import { Command } from "commander"

/**
 * The one parse of a closed-accounts `login` (#12639, #12646). While accounts are closed the device-code sign-in
 * is the only terminal sign-in that runs. `commands.ts` refuses every other closed `login` argv, and the compiled
 * entry (`omo-native/compile-args.ts`) decides from the same argv whether to answer with the static refusal. Both
 * layers read it through this module, so `login -- --device` (an operand, not the option) cannot be a device login
 * to one layer and a refusal to the other.
 */
export function withClosedDeviceLoginOptions(command: Command): Command {
  return command
    .helpOption(false)
    .allowUnknownOption()
    .allowExcessArguments()
    .option("--device")
    .option("--no-browser")
    .option("--api <url>")
    .option("--help")
}

/** The device flow runs only for `--device` or `--no-browser` with nothing else left over (no operand, no unknown option). */
export function isClosedDeviceLogin(
  options: { readonly device?: unknown; readonly browser?: unknown },
  leftover: readonly string[],
): boolean {
  return (options.device === true || options.browser === false) && leftover.length === 0
}

/** Whether a whole `omo …` argv is the closed-accounts device-code login, parsed exactly as `commands.ts` parses it. */
export function parsesAsClosedDeviceLogin(args: readonly string[]): boolean {
  if (args[0] !== "login") return false
  const command = withClosedDeviceLoginOptions(new Command("login"))
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
  try {
    command.parse([...args.slice(1)], { from: "user" })
  } catch {
    // A parse error (e.g. `--api` with no value) is not a device login; the command itself reports it.
    return false
  }
  return isClosedDeviceLogin(command.opts(), command.args)
}

/** The bare form (#13265): plain `login` with no flag and no operand runs the device flow while closed, behind the
 * attach-before-mint refusal (#13096); `login --` parses to exactly this form. Any flag or operand is not bare. */
export function isClosedBareLogin(
  options: {
    readonly device?: unknown
    readonly browser?: unknown
    readonly api?: unknown
    readonly help?: unknown
  },
  leftover: readonly string[],
): boolean {
  return (
    options.device === undefined &&
    options.browser !== false &&
    options.api === undefined &&
    options.help === undefined &&
    leftover.length === 0
  )
}

/** Whether a whole `omo …` argv is the bare closed `login`, parsed exactly as `commands.ts` parses it (#13265). */
export function parsesAsBareClosedLogin(args: readonly string[]): boolean {
  if (args[0] !== "login") return false
  const command = withClosedDeviceLoginOptions(new Command("login"))
    .exitOverride()
    .configureOutput({ writeOut: () => {}, writeErr: () => {} })
  try {
    command.parse([...args.slice(1)], { from: "user" })
  } catch {
    return false
  }
  return isClosedBareLogin(command.opts(), command.args)
}
