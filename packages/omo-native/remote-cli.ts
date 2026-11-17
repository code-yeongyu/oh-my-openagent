import { borrowedService } from "./remote-session-verbs"
import { remoteClientForPerson } from "../omo-senpi/src/components/remote/index"
import { existsSync } from "node:fs"

import { type DeviceService, deviceServiceEndpointPath } from "../device-service-core/src/index.ts"
import { serveRemoteAttach } from "./remote-attach"
import { type BootstrapSetup, type DeviceLink, runBootstrapVerb, runEnableVerb } from "./remote-bootstrap"
import { applyColdWake, type ColdWake } from "./remote-cold-wake"
import type { RemoteOptOut } from "./remote-opt-out"
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
import { parseTarget, type RemoteSessionTarget } from "./remote-session-args"
import { resolveSessionTarget } from "./remote-session-target"
import { attachAddressed, createDeviceServiceSessions } from "../omo-senpi/src/components/remote/port/device-service"
import type { JsonObject } from "../omo-senpi/src/components/thread/remote/ports"

export type { RemoteCommandDependencies } from "./remote-local"
// `omo remote`: the sessions on this account's other devices, through this device's service. A thin CLI over the
// device-service SDK: every command has a human table and a --json form that prints the SDK's typed value as is.
export { REMOTE_EXIT } from "./remote-exit"

/** `omo remote` verbs; `bootstrap` also needs the pinned install, the stored keys and this omo binary. */
export interface RemoteVerbDependencies extends RemoteCommandDependencies {
  readonly bootstrap: BootstrapSetup
  /** The session host unit `bootstrap` and `enable` install, `disable` removes and `status` reads back (omo#13594). */
  readonly coldWake: ColdWake
  /** `enable` and `bootstrap`: hands the signed-in session's device to a service that holds none (omo#13602). */
  readonly linkDevice: DeviceLink
  /** This user's recorded `omo remote disable`, which keeps the default-on bootstrap off (omo#13602). */
  readonly optOut: RemoteOptOut
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
        dependencies,
        parsed.json,
        parsed.afterLogin === true,
      )
    } catch (error) {
      return reportFailure(dependencies, error)
    }
  }
  if (parsed.command === "bootstrap")
    return (await runBootstrapVerb(dependencies, dependencies.bootstrap, dependencies, parsed.json)) === "connected"
      ? REMOTE_EXIT.ok
      : REMOTE_EXIT.unavailable
  // The service manager's view of this device's units is read here, outside remote-local's graph (omo#13440), and
  // handed to `status` as data.
  // `disable` records the user's off before anything that can fail (#13602 review M1): a service that is not running,
  // or a signed-out account, must not let the default-on bootstrap turn remote back on at the next start.
  // A record that cannot be saved never stops disable from turning remote off (#13602 review M2); it is reported and the
  // command fails, so the user knows the next omo login would turn remote on again.
  let recordFailure: string | undefined
  if (parsed.command === "disable") {
    try {
      dependencies.optOut.record()
    } catch (error) {
      recordFailure = error instanceof Error ? error.message : String(error)
    }
  }
  const localUnits = parsed.command === "status" ? await dependencies.coldWake.status() : undefined
  const code = await runLocalRemoteVerb(
    {
      ...dependencies,
      localSessions: dependencies.localSessions ?? thisDeviceSessions,
      ...(localUnits === undefined ? {} : { localUnits }),
    },
    parsed,
  )
  // After the verb's connection is closed (a changed table restarts the device service, which would cut it), and whatever
  // the verb's exit code: the unit goes even when the service could not be reached.
  if (parsed.command === "disable") await applyColdWake(dependencies.coldWake, false, dependencies.error)
  if (recordFailure !== undefined) {
    dependencies.error(disableNotSavedNotice(recordFailure, code === REMOTE_EXIT.ok))
    return REMOTE_EXIT.failed
  }
  return code
}

/**
 * What `omo remote disable` says when it could not save the opt-out (#13602 review M3): that remote is off only when the
 * verb turned the switch off; otherwise that it may still be on.
 */
export function disableNotSavedNotice(reason: string, switchedOff: boolean): string {
  return switchedOff
    ? `omo remote disable: remote is off now, but the choice could not be saved (${reason}); the next omo login will turn it on again.`
    : `omo remote disable: the choice could not be saved (${reason}) and remote could not be turned off, so it may still be on. Fix the error above, then run omo remote disable again.`
}

// This device's own sessions (`sessions` lists them) come from its operator endpoint, a socket: loaded here, on first
// use, outside remote-local's graph (omo#13440), and handed to the person client.
const thisDeviceSessions = async () =>
  (await import("../omo-senpi/src/components/remote/local-sessions")).createLocalSessions()

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
  let parsedTarget: RemoteSessionTarget
  try {
    if (extra.length > 0) throw new UsageError("unexpected arguments")
    parsedTarget = parseTarget("attach", target)
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
    // A bare durable id is found in the account listing; for `<device>/<session>`, attachAddressed locates a durable id on
    // that device and attaches on its key, and attaches a listing key directly (omo#13707).
    const remote = (
      dependencies.remote ??
      ((connected: DeviceService) => ({
        sessions: createDeviceServiceSessions({
          version: connected.serviceVersion,
          connect: async () => ({ conn: connected, owned: false }),
        }),
        // `omo remote` is a person at this device; the account reads go through the one remote client (#13414).
        client: remoteClientForPerson({
          version: connected.serviceVersion,
          stateDir: dependencies.stateDir,
          connect: async () => borrowedService(connected),
          localSessions: dependencies.localSessions ?? thisDeviceSessions,
        }),
        chain: { stamp: (record: JsonObject) => record },
      }))
    )(service)
    // Only the resolve reads through the surface; its client's own connection must not outlive it.
    const resolved = await resolveSessionTarget(remote, parsedTarget).finally(() => remote.client.close())
    if (resolved.kind === "error") {
      service.close()
      dependencies.error(`omo remote: ${resolved.error.message}`)
      dependencies.error(resolved.error.next_action)
      return REMOTE_EXIT.failed
    }
    const { attached: attach } = await attachAddressed(service, resolved.row.device, resolved.row.session_id)
    await attach.snapshot
    const endpoint = await serveRemoteAttach(attach, { label: target ?? parsedTarget.session })
    void service.closed.then(() => endpoint.close())
    return { engineArgs: ["--attach", endpoint.socketPath, "--session", endpoint.sessionRef, "--no-extensions"] }
  } catch (error) {
    service.close()
    return reportFailure(dependencies, error)
  }
}
