import {
  type ServiceAuthHooks,
  runServiceAuthCommand as runAccountsCommand,
} from "../omo-opencode/src/cli/service-auth/commands"
import { cliDeviceServiceHandoff } from "./device-service-handoff"

/** The device-service hand-off both `omo login` and the OpenCode CLI use, so neither path sees only local credentials. */
export const cliServiceAuthHooks: ServiceAuthHooks = {
  deviceService: (api) => cliDeviceServiceHandoff({ api, log: (line) => process.stderr.write(`${line}\n`) }),
}

/** `omo login|logout|whoami` with this machine's device service told about each sign-in and sign-out. */
export const runServiceAuthCommand = (args: readonly string[]): Promise<void> =>
  runAccountsCommand(args, cliServiceAuthHooks)
