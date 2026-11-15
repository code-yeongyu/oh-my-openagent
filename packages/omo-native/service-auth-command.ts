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

/** The remote setup after a service-auth verb: only a successful `omo login`, against the API it signed in to. */
export async function afterServiceAuth(
  args: readonly string[],
  exitCode: number | string,
  setUpRemote: () => Promise<void>,
): Promise<void> {
  if (args[0] !== "login" || Number(exitCode) !== 0) return
  const api = loginApi(args)
  if (api !== undefined) process.env.OMO_SERVICE_API_URL = api
  await setUpRemote()
}
