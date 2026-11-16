import {
  type ServiceAuthHooks,
  runServiceAuthCommand as runAccountsCommand,
} from "../omo-opencode/src/cli/service-auth/commands"
import { cliDeviceServiceHandoff } from "./device-service-handoff"
import { setUpRemoteAfterLogin } from "./remote-entry"

/** The device-service hand-off both `omo login` and the OpenCode CLI use, so neither path sees only local credentials. */
export const cliServiceAuthHooks: ServiceAuthHooks = {
  deviceService: (api) => cliDeviceServiceHandoff({ api, log: (line) => process.stderr.write(`${line}\n`) }),
}

/** `--api <url>` / `--api=<url>`: the API a login signed in against, which the remote setup must read the sign-in from. */
const loginApi = (args: readonly string[]): string | undefined => {
  const at = args.indexOf("--api")
  if (at !== -1) return args[at + 1]
  return args.find((arg) => arg.startsWith("--api="))?.slice("--api=".length)
}

/**
 * `omo login|logout|whoami` with this machine's device service told about each sign-in and sign-out. A successful
 * `omo login` then sets the device up for remote sessions, which are on by default (omo#13602); a failed one does not.
 */
export async function runServiceAuthCommand(args: readonly string[]): Promise<void> {
  await runAccountsCommand(args, cliServiceAuthHooks)
  await afterServiceAuth(args, process.exitCode ?? 0, setUpRemoteAfterLogin)
}

/** The longest the post-login remote setup may hold `omo login` once the sign-in itself succeeded. */
export const LOGIN_REMOTE_SETUP_BOUND_MS = 5_000

export const LOGIN_REMOTE_SETUP_TIMED_OUT =
  "OmO: remote sessions are still being set up for this device; run omo remote status to check them.\n"

// Ends the command at the bound: stdout is flushed first so nothing it already wrote is lost, then the process exits
// with login's own code, because work the setup started (a socket, a child, a timer) would otherwise keep it alive.
async function exitAfterFlush(code: number): Promise<never> {
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()))
  process.exit(code)
}

/** The remote setup after a service-auth verb: only a successful `omo login`, against the API it signed in to. */
export async function afterServiceAuth(
  args: readonly string[],
  exitCode: number | string,
  setUpRemote: () => Promise<void>,
  boundMs: number = LOGIN_REMOTE_SETUP_BOUND_MS,
): Promise<void> {
  if (args[0] !== "login" || Number(exitCode) !== 0) return
  const api = loginApi(args)
  if (api !== undefined) process.env.OMO_SERVICE_API_URL = api
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<"timed_out">((resolve) => {
    timer = setTimeout(() => resolve("timed_out"), boundMs)
  })
  try {
    const outcome = await Promise.race([setUpRemote().then(() => "done" as const), timedOut])
    if (outcome === "timed_out") {
      process.stderr.write(LOGIN_REMOTE_SETUP_TIMED_OUT)
      await exitAfterFlush(Number(exitCode))
    }
  } finally {
    clearTimeout(timer)
  }
}
