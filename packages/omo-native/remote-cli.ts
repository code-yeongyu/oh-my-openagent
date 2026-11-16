import { existsSync } from "node:fs"

import { type DeviceService, deviceServiceEndpointPath } from "../device-service-core/src/index.ts"
import { serveRemoteAttach } from "./remote-attach"
import { type BootstrapSetup, type DeviceLink, runBootstrapVerb, runEnableVerb } from "./remote-bootstrap"
import { applyColdWake, type ColdWake } from "./remote-cold-wake"
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
import { isHelpFlag, REMOTE_USAGE, verbUsage } from "./remote-usage"
import { VERBS } from "./remote-verbs"
import { parseTarget } from "./remote-session-args"
import { resolveSessionTarget } from "./remote-session-target"
import { createDeviceServiceSessions } from "../omo-senpi/src/components/thread/remote/device-service"

export type { RemoteCommandDependencies } from "./remote-local"
// `omo remote`: the sessions on this account's other devices, through this device's service. A thin CLI over the
// device-service SDK: every command has a human table and a --json form that prints the SDK's typed value as is.
export { REMOTE_EXIT } from "./remote-exit"

/** `omo remote` verbs; `bootstrap` also needs the pinned install, the stored keys and this omo binary. */
export interface RemoteVerbDependencies extends RemoteCommandDependencies {
  readonly bootstrap: BootstrapSetup
  /** The session host unit `bootstrap` and `enable` install, `disable` removes and `status` reads back (omo#13594). */
  readonly coldWake: ColdWake
  /** `enable` only: hands the signed-in session's device to a service that holds none (omo#13602). */
  readonly linkDevice: DeviceLink
}

export async function runRemoteVerb(dependencies: RemoteVerbDependencies, args: readonly string[]): Promise<number> {
  // Help is an answer, not a usage error: stdout and exit 0, before anything is parsed or contacted.
  const [first, ...afterFirst] = args
  if (first === "help" || isHelpFlag(first)) {
    dependencies.output(REMOTE_USAGE)
    return REMOTE_EXIT.ok
  }
  // Only the options before a `--` terminator count: after it, `--help` is text (a message to send). The `--` terminator itself lands with #13431.
  const terminator = afterFirst.indexOf("--")
  const options = terminator === -1 ? afterFirst : afterFirst.slice(0, terminator)
  if (VERBS.some((verb) => verb === first) && options.some(isHelpFlag)) {
    dependencies.output(verbUsage(first ?? ""))
    return REMOTE_EXIT.ok
  }
  let parsed: Parsed
  try {
    parsed = parse(args)
    if (!VERBS.some((verb) => verb === parsed.command))
      throw new UsageError(parsed.command === "" ? "" : `omo remote: unknown command ${parsed.command}`)
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    if (error.message) dependencies.error(error.message)
    dependencies.error(REMOTE_USAGE)
    return REMOTE_EXIT.usage
  }
  // `enable` is the one command after `omo login`: the bootstrap (install, connect, register this agent dir), the
  // switch, the device link and the session host unit. It reaches the network, so it is not a local-only verb.
  if (parsed.command === "enable") {
    try {
      return await runEnableVerb(
        dependencies,
        dependencies.bootstrap,
        dependencies.coldWake,
        dependencies.linkDevice,
        parsed.json,
      )
    } catch (error) {
      return reportFailure(dependencies, error)
    }
  }
  if (parsed.command === "bootstrap")
    return (await runBootstrapVerb(dependencies, dependencies.bootstrap, dependencies.coldWake, parsed.json)) ===
      "connected"
      ? REMOTE_EXIT.ok
      : REMOTE_EXIT.unavailable
  // The service manager's view of this device's units is read here, outside remote-local's graph (omo#13440), and
  // handed to `status` as data.
  const localUnits = parsed.command === "status" ? await dependencies.coldWake.status() : undefined
  const code = await runLocalRemoteVerb(
    localUnits === undefined ? dependencies : { ...dependencies, localUnits },
    parsed,
  )
  // After the verb's connection is closed: a changed table restarts the device service, which would cut it.
  if (code === REMOTE_EXIT.ok && parsed.command === "disable")
    await applyColdWake(dependencies.coldWake, false, dependencies.error)
  return code
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
  if (args.some(isHelpFlag)) {
    dependencies.output(verbUsage("attach"))
    return REMOTE_EXIT.ok
  }
  const [target, ...extra] = args
  let parsedTarget: ReturnType<typeof parseTarget>
  try {
    parsedTarget = parseTarget("attach", target)
    if (extra.length > 0) throw new UsageError("unexpected arguments")
  } catch (error) {
    if (!(error instanceof UsageError)) throw error
    dependencies.error("usage: omo remote attach <device>/<session>   (the SESSION column of omo remote sessions)")
    return REMOTE_EXIT.usage
  }
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
    const remote = (
      dependencies.remote ??
      ((connected) => ({
        sessions: createDeviceServiceSessions({
          version: connected.serviceVersion,
          // The attach command owns this connection and closes it itself: the port only borrows it.
          connect: async () => ({ conn: connected, owned: false }),
        }),
        chain: { stamp: (record) => record },
      }))
    )(service)
    const resolved = await resolveSessionTarget(remote, parsedTarget)
    if (resolved.kind === "error") {
      service.close()
      dependencies.error(`omo remote: ${resolved.error.message}`)
      dependencies.error(resolved.error.next_action)
      return REMOTE_EXIT.failed
    }
    const attach = await service.attach(resolved.row.device, resolved.row.session_id)
    await attach.snapshot
    const endpoint = await serveRemoteAttach(attach, { label: target ?? parsedTarget.session })
    void service.closed.then(() => endpoint.close())
    return { engineArgs: ["--attach", endpoint.socketPath, "--session", endpoint.sessionRef, "--no-extensions"] }
  } catch (error) {
    service.close()
    return reportFailure(dependencies, error)
  }
}
