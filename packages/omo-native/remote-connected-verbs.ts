import type { DeviceService, SessionFilter } from "../device-service-core/src/index.ts"
import type { RemoteCommandDependencies } from "./remote-cli"
import type { ColdWake } from "./remote-cold-wake"
import { REMOTE_EXIT, UsageError } from "./remote-exit"
import { controlLines, deviceLines, localRows, sessionLines, statusLines } from "./remote-render"
import type { SessionArgs } from "./remote-session-args"
import { runSession } from "./remote-session-verbs"

// The `omo remote` verbs that run on a connected device service. `enable` and `bootstrap` are not here: they run the
// bootstrap first (remote-bootstrap.ts), because they must work on a device whose service is not running yet.

export type ControlValue = "on" | "off"

export type ParsedVerb = {
  readonly command: string
  readonly json: boolean
  readonly filter: SessionFilter
  readonly control: ControlValue | undefined
  readonly session?: SessionArgs
}

export async function runConnectedVerb(
  service: DeviceService,
  parsed: ParsedVerb,
  dependencies: RemoteCommandDependencies,
  coldWake: ColdWake,
): Promise<number> {
  const print = (value: unknown, human: () => readonly string[]) => {
    if (parsed.json) dependencies.output(JSON.stringify(value))
    else for (const line of human()) dependencies.output(line)
    return REMOTE_EXIT.ok
  }
  switch (parsed.command) {
    case "status": {
      // The service's own status, plus what this device's service manager says about its two units (omo#13594).
      const [status, local] = await Promise.all([service.status(), coldWake.status()])
      return print(local === undefined ? status : { ...status, local }, () =>
        statusLines(status, service.serviceVersion, local === undefined ? [] : localRows(local)),
      )
    }
    case "devices": {
      const devices = await service.devices()
      return print(devices, () => deviceLines(devices, dependencies.now()))
    }
    case "sessions": {
      const [result, devices] = await Promise.all([service.sessions(parsed.filter), service.devices()])
      const labels = new Map(devices.map((device) => [device.device, device.label]))
      return print(result, () => sessionLines(result, labels, dependencies.now()))
    }
    case "disable": {
      const enabled = await service.setEnabled(false)
      return print({ enabled }, () => [`Remote sessions are ${enabled ? "on" : "off"} for this device.`])
    }
    case "control": {
      if (!service.capabilities.includes("control")) {
        dependencies.error(
          "The OmO device service on this device does not have remote control yet. Update OmO, then try again.",
        )
        return REMOTE_EXIT.unavailable
      }
      const state =
        parsed.control === undefined
          ? await service.attachControl()
          : await service.setAttachControl(parsed.control === "on")
      return print(state, () => controlLines(state, dependencies.now()))
    }
    case "open":
    case "send":
    case "model":
    case "interrupt":
    case "close":
      if (parsed.session !== undefined) return runSession(service, parsed.session, parsed.json, dependencies)
      throw new UsageError(`omo remote ${parsed.command}: arguments were not parsed`)
    default:
      throw new UsageError(
        parsed.command === "" ? "omo remote: a command is required" : `omo remote: unknown command ${parsed.command}`,
      )
  }
}
