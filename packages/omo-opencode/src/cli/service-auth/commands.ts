import { Command } from "commander"
import { isCancel, select, confirm } from "@clack/prompts"
import { serviceAccountsOpen } from "./accounts-gate"
import { isClosedBareLogin, isClosedDeviceLogin, withClosedDeviceLoginOptions } from "./closed-device-login"
import { openSignInBrowser } from "./browser"
import { deviceName, devicePlatform } from "./device-name"
import { loginDevice } from "./device-flow"
import { advertisesMachineIdentity, readMachineDigest } from "./machine-digest"
import { refuseSecondMachineDevice } from "./machine-device"
import { createCredentialStore, INTERACTIVE_READ_WAIT } from "./keystore"
import { BrowserUnavailable, loginLoopback } from "./loopback"
import { type ChooseDevice, type ListedDevice, RequestFailure, serviceOrigin, SignInError } from "./protocol"
import { resolveMemoryRoot, syncPinDir } from "@oh-my-opencode/memory-core/sync-device-retire"

import { createSession, type DeviceServiceHandoff, type Session } from "./session"
import { retireSyncPinOnDiscard } from "./sync-pin-retire"
import { terminalText } from "./terminal-text"

// Probe the service before anything user-visible (a browser tab, a device code) so an
// unreachable or unhealthy service fails at once instead of after a dead page and a wait.
async function ensureServiceAvailable(session: Pick<Session, "request">, api: string): Promise<unknown> {
  try {
    return await session.request("/v1/health", { method: "GET" })
  } catch (error) {
    if (!(error instanceof SignInError)) throw error
    // No usable HTTP answer (DNS, refused, TLS, timeout, non-JSON body): the client can't tell a
    // service that hasn't launched from an offline network, so it names both.
    if (error instanceof RequestFailure) {
      throw new SignInError(
        `Can't reach OmO accounts at ${api}. The service may not be available yet, or your network, proxy or certificate settings are blocking it.`,
      )
    }
    throw new SignInError(`OmO accounts at ${api} aren't available right now. Try again later.`)
  }
}

/**
 * Login order (#6503): refuse a second device from the stored sign-in and the machine's device service before
 * `/v1/health`. A logged-out computer is the one that waits on accounts being reachable.
 */
export async function beginLogin(
  session: Pick<Session, "accessSnapshot" | "request">,
  deviceService: DeviceServiceHandoff | undefined,
  api: string,
): Promise<unknown> {
  await refuseSecondMachineDevice(session, deviceService)
  return ensureServiceAvailable(session, api)
}

type Options = {
  readonly api?: string
  readonly accounts?: string
  readonly device?: boolean
  readonly browser?: boolean
  readonly help?: boolean
}

/** What the host adds to the account commands: its device service for an API origin (design D r9 sections 4-5). */
export type ServiceAuthHooks = { readonly deviceService?: (api: string) => DeviceServiceHandoff }

export function deviceChoices(devices: readonly ListedDevice[]) {
  return devices.map((device) => ({ value: device.id, label: terminalText(device.name) }))
}

const chooseDevice: ChooseDevice = async (devices) => {
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

/** The default OmO API origin; a different one is printed before any device code (#13265). */
const DEFAULT_API_ORIGIN = "https://api.omo.dev"

/** The sign-in origin: the `--accounts` flag, then `OMO_SERVICE_ACCOUNTS_URL`, then the default. */
export function accountsOrigin(options: Pick<Options, "accounts">, env: Record<string, string | undefined>): string {
  return serviceOrigin(options.accounts ?? env.OMO_SERVICE_ACCOUNTS_URL ?? DEFAULT_ACCOUNTS_ORIGIN)
}

async function run(
  action: "login" | "logout" | "whoami",
  options: Options,
  hooks: ServiceAuthHooks = {},
): Promise<void> {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  process.once("SIGINT", cancel)
  process.once("SIGTERM", cancel)
  try {
    const api = serviceOrigin(options.api ?? process.env.OMO_SERVICE_API_URL ?? DEFAULT_API_ORIGIN)
    const store = createCredentialStore(api, { wait: INTERACTIVE_READ_WAIT })
    const deviceService = hooks.deviceService?.(api)
    const session = createSession({
      api,
      store,
      signal: controller.signal,
      ...(deviceService === undefined ? {} : { deviceService }),
      beforeKeysDiscarded: retireSyncPinOnDiscard({
        pinDir: () => syncPinDir(resolveMemoryRoot(process.env, process.cwd())),
        log: (line) => console.error(line),
      }),
    })
    if (action === "logout") {
      const revoked = await session.logout()
      console.log("Signed out of OmO. Stored credentials and device keys were removed.")
      if (!revoked)
        console.error(
          "Server device revocation could not be confirmed. Remove this device from the Devices page of your OmO account when connected.",
        )
      return
    }
    if (action === "whoami") {
      await session.accessToken()
      const [saved, email] = await Promise.all([store.read(), session.accountEmail().catch(() => undefined)])
      console.log(
        saved
          ? email === undefined
            ? `Signed in to ${api} as ${terminalText(saved.device.name)}.`
            : `Signed in to ${api} as ${terminalText(email)} (${terminalText(saved.device.name)}).`
          : "Not signed in.",
      )
      return
    }
    // Local sign-in and the device service first, so an already-signed-in computer is told to log out
    // even when accounts are unreachable. A logged-out computer then hears a health failure as itself.
    const health = await beginLogin(session, deviceService, api)
    const machineDigest = advertisesMachineIdentity(health) ? await readMachineDigest() : undefined
    const digest = machineDigest === undefined ? {} : { machineDigest }
    const name = deviceName()
    const platform = devicePlatform()
    // #13265: a redirected API origin is visible before any code prints, and the success line names the account
    // (C5): a wrong-account approval is silent no longer, and a failed account read still says how to see it.
    if (api !== DEFAULT_API_ORIGIN) console.log(`OmO API: ${api}`)
    const signedIn = async () => {
      const email = await session.accountEmail().catch(() => undefined)
      console.log(
        email === undefined
          ? "Signed in to OmO. The account could not be read; run omo whoami to see it."
          : `Signed in to OmO as ${terminalText(email)}.`,
      )
    }
    if (!options.device && options.browser !== false) {
      try {
        await loginLoopback(session, {
          accounts: accountsOrigin(options, process.env),
          name,
          platform,
          open: openSignInBrowser,
          chooseDevice,
          ...digest,
        })
        await signedIn()
        return
      } catch (error) {
        if (!(error instanceof BrowserUnavailable)) throw error
      }
    }
    await loginDevice(session, {
      name,
      platform,
      chooseDevice,
      ...digest,
      show: (code) => {
        console.log(`Open ${code.verificationUri}`)
        console.log(`User code: ${code.userCode}`)
        console.log(`Matching code: ${code.matchingCode}`)
      },
    })
    await signedIn()
  } catch (error) {
    console.error(
      controller.signal.aborted
        ? "Sign-in cancelled."
        : error instanceof SignInError
          ? error.message
          : "OmO sign-in stopped on an unexpected error. Run the command again, and report it with /bug if it keeps failing.",
    )
    process.exitCode = 1
  } finally {
    process.removeListener("SIGINT", cancel)
    process.removeListener("SIGTERM", cancel)
  }
}

export { SERVICE_ACCOUNTS_OPEN } from "./accounts-gate"

/** #13265: the forms of omo login that still refuse while accounts are closed hear a refusal that names the route. */
export const CLOSED_LOGIN_MESSAGE =
  "This form of omo login isn't available while OmO accounts are closed. Run plain omo login to sign in by device code (the route for a computer without the OmO desktop app's sign-in), or omo login --device."

const CLOSED_LOGIN_HELP = `Sign in to OmO from this terminal with a device code.

While OmO accounts are closed, omo login signs a computer in by device code: omo prints a
verification URL with a user code and a matching code, a person approves on another device,
and the credential is stored in the OS credential store.

  omo login                 device-code sign-in (a computer without the OmO desktop app's sign-in)
  omo login --device        force the device-code route
  omo login --no-browser    the same, never opening a browser
  omo login --api <url>     OmO API origin (or OMO_SERVICE_API_URL)

The service's approval page decides who may sign in. A computer whose OmO desktop app or
stored sign-in already has its device is refused instead of registering a second one.`

const CLOSED_LOGOUT_HELP = `Sign out of OmO: revoke this machine's device and remove the stored credentials and device keys.

  omo logout [--api <url>]

This runs while OmO accounts are closed. One machine is one device: on a computer that
shares the OmO desktop app's sign-in, this signs the whole machine out.`

const CLOSED_WHOAMI_HELP = `Show the current OmO device sign-in.

  omo whoami [--api <url>]

This runs while OmO accounts are closed.`

function refuseClosedServiceAuth(): never {
  console.error(CLOSED_LOGIN_MESSAGE)
  process.exit(1)
}

function describeClosedAuthCommand(name: "login" | "logout" | "whoami") {
  return () => {
    console.log(name === "login" ? CLOSED_LOGIN_HELP : name === "logout" ? CLOSED_LOGOUT_HELP : CLOSED_WHOAMI_HELP)
    process.exit(0)
  }
}

function configureClosedServiceAuthCommands(program: Command, hooks: ServiceAuthHooks): void {
  configureClosedDeviceLogin(program, hooks)
  for (const name of ["logout", "whoami"] as const) {
    const command = program
      .command(name, { hidden: true })
      .helpOption(false)
      .allowUnknownOption()
      .allowExcessArguments()
      .option("--api <url>")
      .action((options: Options) => {
        if (command.args.length !== 0) refuseClosedServiceAuth()
        return run(name, options, hooks)
      })
    // `omo help <name>` calls the subcommand's help() directly, bypassing its action.
    command.help = describeClosedAuthCommand(name)
  }
}

// While accounts are closed, the one terminal sign-in is the device code, for a computer with no browser or desktop app
// (#12639). The approval page keeps the service's own access policy, so this admits nobody the service does not admit.
// #13265: plain `login` joins the device forms behind the attach refusal (#13096), so a computer with no desktop sign-in
// signs in from the terminal; `login --help` describes the route. Every other closed argv still refuses, naming it.
function configureClosedDeviceLogin(program: Command, hooks: ServiceAuthHooks): void {
  const command = withClosedDeviceLoginOptions(program.command("login", { hidden: true })).action(
    (options: Options) => {
      if (options.help === true) {
        console.log(CLOSED_LOGIN_HELP)
        return
      }
      if (isClosedDeviceLogin(options, command.args) || isClosedBareLogin(options, command.args))
        return run("login", { ...options, device: true }, hooks)
      refuseClosedServiceAuth()
    },
  )
  command.help = describeClosedAuthCommand("login")
}

export function configureServiceAuthCommands(
  program: Command,
  open = serviceAccountsOpen(),
  hooks: ServiceAuthHooks = {},
): void {
  if (!open) {
    configureClosedServiceAuthCommands(program, hooks)
    return
  }
  program
    .command("login")
    .description("Sign in to OmO using the OS credential store")
    .option("--device", "Use a device code instead of a browser callback")
    .option("--no-browser", "Sign in by device code without opening a browser")
    .option("--api <url>", "OmO API origin (or OMO_SERVICE_API_URL)")
    .option("--accounts <url>", "OmO sign-in page origin (or OMO_SERVICE_ACCOUNTS_URL)")
    .action((options: Options) => run("login", options, hooks))
  for (const action of ["logout", "whoami"] as const) {
    program
      .command(action)
      .description(
        action === "logout" ? "Remove stored OmO credentials and device keys" : "Show the current OmO device sign-in",
      )
      .option("--api <url>", "OmO API origin (or OMO_SERVICE_API_URL)")
      .action((options: Options) => run(action, options, hooks))
  }
}

/** The root program the service-auth bundle parses `omo login|logout|whoami` with. */
export function serviceAuthProgram(open = serviceAccountsOpen(), hooks: ServiceAuthHooks = {}): Command {
  const program = new Command("omo")
  configureServiceAuthCommands(program, open, hooks)
  return program
}

export async function runServiceAuthCommand(args: readonly string[], hooks: ServiceAuthHooks = {}): Promise<void> {
  await serviceAuthProgram(serviceAccountsOpen(), hooks).parseAsync([...args], { from: "user" })
}
