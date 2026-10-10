import { Command } from "commander"
import { isCancel, select, confirm } from "@clack/prompts"
import { openSignInBrowser } from "./browser"
import { deviceName, devicePlatform } from "./device-name"
import { loginDevice } from "./device-flow"
import { createCredentialStore } from "./keystore"
import { BrowserUnavailable, loginLoopback } from "./loopback"
import { type ChooseDevice, type ListedDevice, serviceOrigin, SignInError } from "./protocol"
import { createSession } from "./session"
import { terminalText } from "./terminal-text"

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
    const name = deviceName()
    const platform = devicePlatform()
    if (!options.device && options.browser !== false) {
      try {
        await loginLoopback(session, {
          accounts: serviceOrigin(options.accounts ?? process.env.OMO_SERVICE_ACCOUNTS_URL ?? "https://accounts.omo.dev"),
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

export function configureServiceAuthCommands(program: Command): void {
  program.command("login").description("Sign in to OmO using the OS credential store")
    .option("--device", "Use a device code instead of a browser callback")
    .option("--no-browser", "Sign in by device code without opening a browser")
    .option("--api <url>", "OmO API origin (or OMO_SERVICE_API_URL)")
    .option("--accounts <url>", "OmO accounts origin (or OMO_SERVICE_ACCOUNTS_URL)")
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
