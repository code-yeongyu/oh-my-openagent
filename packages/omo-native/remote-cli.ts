import { existsSync } from "node:fs"

import {
  type DeviceService,
  deviceServiceEndpointPath,
} from "../device-service-core/src/index.ts"
import { serveRemoteAttach } from "./remote-attach"
import { type BootstrapSetup, runBootstrapVerb } from "./remote-bootstrap"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import {
  accountNotice,
  isServiceStopped,
  type Parsed,
  parse,
  type RemoteCommandDependencies,
  reportFailure,
  runLocalRemoteVerb,
} from "./remote-local"
import { VERBS } from "./remote-verbs"

export type { RemoteCommandDependencies } from "./remote-local"
// `omo remote`: the sessions on this account's other devices, through this device's service. A thin CLI over the
// device-service SDK: every command has a human table and a --json form that prints the SDK's typed value as is.
export { REMOTE_EXIT } from "./remote-exit"

const REMOTE_USAGE = `usage: omo remote <command> [--json]
  status                                   the device service's connection state
  devices                                  the devices on this account
  sessions [--device D] [--project P] [--state running|idle|ended]
                                           sessions across the account's devices
  enable | disable                         turn remote sessions on or off for this device
  control [on|off]                         whether your other signed-in devices can view and command this
                                           device's sessions (on unless you turn it off)
  bootstrap                                set up this device's service for your sign-in (every omo start runs it)
  attach <device>/<session>                open a session on another device in the terminal UI, to watch and type
  open <device> [--project P] [--model M] [--permission-preset MODE]
                                           start a session on another device; prints <device>/<session>; it runs
                                           in MODE (default: this device's own setting, else full-access)
  send <device>/<session> <text> [--steer|--follow-up] [--no-wait]
                                           send a message and print the answer as it arrives (--steer: into the
                                           running turn; --no-wait: return once the session took it)
  model <device>/<session> <provider/id>   switch the session's model
  interrupt <device>/<session>             stop the session's running turn
  close <device>/<session>                 end the session on its device`

/** `omo remote` verbs; `bootstrap` also needs the pinned install, the stored keys and this omo binary. */
export interface RemoteVerbDependencies extends RemoteCommandDependencies {
  readonly bootstrap: BootstrapSetup
}

export async function runRemoteVerb(dependencies: RemoteVerbDependencies, args: readonly string[]): Promise<number> {
  let parsed: Parsed
  try {
    parsed = parse(args)
    if (!VERBS.some((verb) => verb === parsed.command))
      throw new UsageError(
        parsed.command === "" || parsed.command === "help" || parsed.command === "--help"
          ? ""
          : `omo remote: unknown command ${parsed.command}`,
      )
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    if (error.message) dependencies.error(error.message)
    dependencies.error(REMOTE_USAGE)
    return REMOTE_EXIT.usage
  }
  if (parsed.command === "bootstrap")
    return (await runBootstrapVerb(dependencies, dependencies.bootstrap, parsed.json)) === "connected"
      ? REMOTE_EXIT.ok
      : REMOTE_EXIT.unavailable
  return runLocalRemoteVerb(dependencies, parsed)
}

export type RemoteAttachLaunch = { readonly engineArgs: readonly string[] }

/**
 * `omo remote attach <device>/<session>`: attaches through the device service and serves the session on a private
 * endpoint for the engine's attach TUI. Returns the engine arguments to launch, or the exit code when it cannot.
 */
export async function prepareRemoteAttach(
  dependencies: RemoteCommandDependencies,
  args: readonly string[],
): Promise<RemoteAttachLaunch | number> {
  const [target, ...extra] = args
  const slash = target?.indexOf("/") ?? -1
  if (target === undefined || extra.length > 0 || slash <= 0 || slash === target.length - 1) {
    dependencies.error("usage: omo remote attach <device>/<session>   (the SESSION column of omo remote sessions)")
    return REMOTE_EXIT.usage
  }
  const device = target.slice(0, slash)
  const sessionId = target.slice(slash + 1)
  const signedOut = await accountNotice(dependencies)
  if (signedOut !== undefined) return signedOut
  if (!existsSync(dependencies.stateDir) || !existsSync(deviceServiceEndpointPath(dependencies.stateDir))) {
    dependencies.error("The OmO device service is not running on this device.")
    return REMOTE_EXIT.unavailable
  }
  let service: DeviceService
  try {
    service = await dependencies.connect()
  } catch (error) {
    if (isServiceStopped(error)) {
      dependencies.error("The OmO device service is not running on this device.")
      return REMOTE_EXIT.unavailable
    }
    return reportFailure(dependencies, error)
  }
  try {
    const attach = await service.attach(device, sessionId)
    await attach.snapshot
    const endpoint = await serveRemoteAttach(attach, { label: target })
    void service.closed.then(() => endpoint.close())
    return { engineArgs: ["--attach", endpoint.socketPath, "--session", endpoint.sessionRef, "--no-extensions"] }
  } catch (error) {
    service.close()
    return reportFailure(dependencies, error)
  }
}
