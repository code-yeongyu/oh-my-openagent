import { homedir } from "node:os"

import {
  type ColdWakeOutcome,
  ColdWakeUnitError,
  installColdWake,
  readColdWake,
  refreshColdWake,
  runCommand,
  SessionHostLaunch,
  uninstallColdWake,
  type UnitState,
} from "../device-service-core/src/index.ts"
import { RELEASE_VERSION } from "./release-version"

// omo#13594: the cold-wake unit of this device. `omo remote bootstrap` and `enable` install it, `disable` removes it, and a
// bootstrap on a device whose remote sessions are off removes it too, so it never comes back while they stay off.

export type ColdWake = {
  readonly install: () => Promise<ColdWakeOutcome>
  readonly uninstall: () => Promise<ColdWakeOutcome>
  /** What this device's service manager reports about both units; undefined where there is no session host unit. */
  readonly status: () => Promise<LocalStatus | undefined>
}

/** The `local` part of `omo remote status --json`. */
export type LocalStatus = {
  readonly session_host: {
    readonly unit: string
    readonly state: UnitState
    readonly enabled: boolean
    readonly pinned: boolean | "unknown"
  }
  readonly device_service: { readonly unit: string; readonly state: UnitState }
  readonly cold_wake_entry: boolean | "unknown"
  readonly agent_dir: string
}

const UNSUPPORTED: ColdWakeOutcome = { kind: "unsupported" }

const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

type ColdWakeOptions = {
  readonly binaryPath: string
  readonly agentDir: string
  readonly platform?: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** This device's service manager and the session host start for `binaryPath`; undefined off Linux and macOS. */
function deviceColdWake(options: ColdWakeOptions) {
  const platform = options.platform ?? process.platform
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined
  if ((platform !== "linux" && platform !== "darwin") || uid === undefined) return undefined
  const host = { platform, home: homedir(), uid, run: runCommand, pause }
  const launchOf = (): SessionHostLaunch | ColdWakeOutcome => {
    try {
      return SessionHostLaunch.from({
        omoBin: options.binaryPath,
        execPath: process.execPath,
        agentDir: options.agentDir,
        path: (options.env ?? process.env).PATH,
      })
    } catch (error) {
      if (error instanceof ColdWakeUnitError) return { kind: "failed", step: "unit", detail: error.message }
      throw error
    }
  }
  return { host, launchOf }
}

/** This device's cold wake: the unit runs `binaryPath daemon run` for `agentDir`. Linux and macOS only. */
export function coldWakeSetup(options: ColdWakeOptions): ColdWake {
  const device = deviceColdWake(options)
  if (device === undefined)
    return { install: async () => UNSUPPORTED, uninstall: async () => UNSUPPORTED, status: async () => undefined }
  const { host, launchOf } = device
  const withLaunch = async (apply: (launch: SessionHostLaunch) => Promise<ColdWakeOutcome>) => {
    const launch = launchOf()
    return launch instanceof SessionHostLaunch ? apply(launch) : launch
  }
  return {
    install: () => withLaunch((launch) => installColdWake(host, launch)),
    uninstall: () => withLaunch((launch) => uninstallColdWake(host, launch)),
    status: async () => {
      const launch = launchOf()
      if (!(launch instanceof SessionHostLaunch)) return undefined
      const read = await readColdWake(host, launch)
      return {
        session_host: { ...read.sessionHost, pinned: read.pinnedHost },
        device_service: read.deviceService,
        cold_wake_entry: read.coldWakeEntry,
        agent_dir: options.agentDir,
      }
    },
  }
}

/** One line for stderr when the cold wake could not be set up or removed; nothing when it was, or never applies here. */
function coldWakeNotice(outcome: ColdWakeOutcome): string | undefined {
  switch (outcome.kind) {
    case "installed":
    case "removed":
    case "unsupported":
      return undefined
    case "service_not_installed":
      return "Cold wake is not set up: the OmO device service is not installed as a user service on this device."
    case "table_invalid":
      return `Cold wake is not set up: the device service's OMO_RELAYD_SERVICES table cannot be read (${outcome.reason}). Fix or remove it, then run omo remote bootstrap.`
    case "failed":
      return `Cold wake could not be set up (${outcome.step}: ${outcome.detail}). Messages to this device's sessions need a running omo until it is.`
  }
}

/**
 * omo#14191: the first launch of a new runtime brings an installed session host unit to that runtime (its shape and its
 * program), as `omo remote enable` writes it; `omo update` cannot, because the new runtime copy only exists once the new
 * launcher has run. A failure is one line on `error` and never blocks the launch.
 */
export async function refreshColdWakeAtLaunch(
  options: ColdWakeOptions & { readonly version: string },
  error: (line: string) => void,
): Promise<void> {
  const device = deviceColdWake(options)
  if (device === undefined || !RELEASE_VERSION.test(options.version)) return
  const launch = device.launchOf()
  try {
    const outcome =
      launch instanceof SessionHostLaunch
        ? await refreshColdWake(
            device.host,
            launch,
            (installed) => RELEASE_VERSION.test(installed) && Bun.semver.order(installed, options.version) > 0,
          )
        : launch
    const notice = outcome === undefined ? undefined : coldWakeNotice(outcome)
    if (notice !== undefined) error(notice)
  } catch (cause) {
    error(`Cold wake could not be refreshed (${cause instanceof Error ? cause.message : String(cause)}).`)
  }
}

export async function applyColdWake(
  coldWake: ColdWake,
  enabled: boolean,
  error: (line: string) => void,
): Promise<ColdWakeOutcome> {
  const outcome = await (enabled ? coldWake.install() : coldWake.uninstall())
  // Removing finds nothing to remove when the device service is not installed: that is not worth a notice.
  const notice = !enabled && outcome.kind === "service_not_installed" ? undefined : coldWakeNotice(outcome)
  if (notice !== undefined) error(notice)
  return outcome
}
