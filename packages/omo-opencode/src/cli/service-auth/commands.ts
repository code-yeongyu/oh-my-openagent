import { Command } from "commander"
import { isCancel, select, confirm } from "@clack/prompts"
import { openSignInBrowser } from "./browser"
import { deviceName, devicePlatform } from "./device-name"
import { loginDevice } from "./device-flow"
import { createCredentialStore } from "./keystore"
import { BrowserUnavailable, loginLoopback } from "./loopback"
import { type ChooseDevice, type ListedDevice, RequestFailure, serviceOrigin, SignInError } from "./protocol"
import { createSession, type Session } from "./session"
import { terminalText } from "./terminal-text"

// Probe the service before anything user-visible (a browser tab, a device code) so an
// unreachable or unhealthy service fails at once instead of after a dead page and a wait.
async function ensureServiceAvailable(session: Pick<Session, "request">, api: string): Promise<void> {
  try {
    await session.request("/v1/health", { method: "GET" })
  } catch (error) {
    if (!(error instanceof SignInError)) throw error
    // No usable HTTP answer (DNS, refused, TLS, timeout, non-JSON body): the client can't tell a
    // service that hasn't launched from an offline network, so it names both.
    if (error instanceof RequestFailure) {
      throw new SignInError(`Can't reach OmO accounts at ${api}. The service may not be available yet, or your network, proxy or certificate settings are blocking it.`)
    }
    throw new SignInError(`OmO accounts at ${api} aren't available right now. Try again later.`)
  }
}

type Options = { readonly api?: string; readonly accounts?: string; readonly device?: boolean; readonly browser?: boolean }

export function deviceChoices(devices: readonly ListedDevice[]) {
  return devices.map(device => ({ value: device.id, label: terminalText(device.name) }))
}

const chooseDevice: ChooseDevice = async devices => {
  if (!process.stdin.isTTY || devices.length === 0) {
    console.error("Device limit reached. Run omo login in an interactive terminal to choose a device to remove.")
    return null
  }
  const chosen = await select({
    message: "Device limit reached. Remove a device to sign in?",
    options: [{ value: "", label: "Cancel (keep all devices)" }, ...deviceChoices(devices)],
  })
  if (isCancel(chosen) || chosen === "") return null
  const agreed = await confirm({ message: "Sign out the selected device?", initialValue: false })
  return agreed === true ? chosen : null
}

/** The OmO sign-in page. `accounts.omo.dev` is the identity provider's own account portal (#9965). */
export const DEFAULT_ACCOUNTS_ORIGIN = "https://signin.omo.dev"

/** The sign-in origin: the `--accounts` flag, then `OMO_SERVICE_ACCOUNTS_URL`, then the default. */
export function accountsOrigin(options: Pick<Options, "accounts">, env: Record<string, string | undefined>): string {
  return serviceOrigin(options.accounts ?? env.OMO_SERVICE_ACCOUNTS_URL ?? DEFAULT_ACCOUNTS_ORIGIN)
}

async function run(action: "login" | "logout" | "whoami", options: Options): Promise<void> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once("SIGINT", cancel)
  process.once("SIGTERM", cancel)
  try {
    const api = serviceOrigin(options.api ?? process.env.OMO_SERVICE_API_URL ?? "https://api.omo.dev")
    const store = createCredentialStore(api)
    const session = createSession({ api, store, signal: controller.signal })
    if (action === "logout") {
      const revoked = await session.logout()
      console.log("Signed out of OmO. Stored credentials and device keys were removed.")
      if (!revoked) console.error("Server device revocation could not be confirmed. Remove this device from the Devices page of your OmO account when connected.")
      return
    }
    if (action === "whoami") {
      await session.accessToken()
      const saved = await store.read()
      console.log(saved ? `Signed in to ${api} as ${terminalText(saved.device.name)}.` : "Not signed in.")
      return
    }
    await ensureServiceAvailable(session, api)
    const name = deviceName()
    const platform = devicePlatform()
    if (!options.device && options.browser !== false) {
      try {
        await loginLoopback(session, {
          accounts: accountsOrigin(options, process.env),
          name, platform, open: openSignInBrowser, chooseDevice,
        })
        console.log("Signed in to OmO.")
        return
      } catch (error) {
        if (!(error instanceof BrowserUnavailable)) throw error
      }
    }
    await loginDevice(session, {
      name, platform, chooseDevice,
      show: code => {
        console.log(`Open ${code.verificationUri}`)
        console.log(`User code: ${code.userCode}`)
        console.log(`Matching code: ${code.matchingCode}`)
      },
    })
    console.log("Signed in to OmO.")
  } catch (error) {
    console.error(controller.signal.aborted ? "Sign-in cancelled."
      : error instanceof SignInError ? error.message : "Unable to complete OmO sign-in. Check the OS credential store and try again.")
    process.exitCode = 1
  } finally {
    process.removeListener("SIGINT", cancel)
    process.removeListener("SIGTERM", cancel)
  }
}

/** The one switch for OmO service accounts (#10262): set to true when accounts open to everyone. */
export const SERVICE_ACCOUNTS_OPEN: boolean = false

export const SERVICE_ACCOUNTS_CLOSED_MESSAGE = "OmO accounts aren't available yet."

const SERVICE_AUTH_COMMANDS = ["login", "logout", "whoami"] as const

// The sign-in suites exercise the real flow through the launcher; their in-process preload opens
// the commands here, which nothing a user can set (no env var, flag or config) reaches.
const testOpenKey = Symbol.for("omo.test.serviceAccountsOpen")

function serviceAccountsOpen(): boolean {
  return SERVICE_ACCOUNTS_OPEN || (globalThis as Record<symbol, unknown>)[testOpenKey] === true
}

function refuseClosedServiceAuth(): never {
  console.error(SERVICE_ACCOUNTS_CLOSED_MESSAGE)
  process.exit(1)
}

function configureClosedServiceAuthCommands(program: Command): void {
  for (const name of SERVICE_AUTH_COMMANDS) {
    const command = program.command(name, { hidden: true }).helpOption(false).allowUnknownOption().allowExcessArguments()
      .action(() => {
        console.error(SERVICE_ACCOUNTS_CLOSED_MESSAGE)
        process.exitCode = 1
      })
    // `omo help <name>` calls the subcommand's help() directly, bypassing its action.
    command.help = refuseClosedServiceAuth
  }
}

export function configureServiceAuthCommands(program: Command, open = serviceAccountsOpen()): void {
  if (!open) {
    configureClosedServiceAuthCommands(program)
    return
  }
  program.command("login").description("Sign in to OmO using the OS credential store")
    .option("--device", "Use a device code instead of a browser callback")
    .option("--no-browser", "Sign in by device code without opening a browser")
    .option("--api <url>", "OmO API origin (or OMO_SERVICE_API_URL)")
    .option("--accounts <url>", "OmO sign-in page origin (or OMO_SERVICE_ACCOUNTS_URL)")
    .action((options: Options) => run("login", options))
  for (const action of ["logout", "whoami"] as const) {
    program.command(action)
      .description(action === "logout" ? "Remove stored OmO credentials and device keys" : "Show the current OmO device sign-in")
      .option("--api <url>", "OmO API origin (or OMO_SERVICE_API_URL)")
      .action((options: Options) => run(action, options))
  }
}

export async function runServiceAuthCommand(args: readonly string[]): Promise<void> {
  const program = new Command("omo")
  configureServiceAuthCommands(program)
  await program.parseAsync([...args], { from: "user" })
}
