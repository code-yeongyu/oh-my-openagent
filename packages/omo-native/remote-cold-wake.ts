import { homedir } from "node:os"

import {
  type ColdWakeOutcome,
  ColdWakeUnitError,
  installColdWake,
  runCommand,
  SessionHostLaunch,
  uninstallColdWake,
} from "../device-service-core/src/index.ts"

// omo#13594: the cold-wake unit of this device. `omo remote bootstrap` and `enable` install it, `disable` removes it, and a
// bootstrap on a device whose remote sessions are off removes it too, so it never comes back while they stay off.

export type ColdWake = {
  readonly install: () => Promise<ColdWakeOutcome>
  readonly uninstall: () => Promise<ColdWakeOutcome>
}

const UNSUPPORTED: ColdWakeOutcome = { kind: "unsupported" }

const pause = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds))

/** This device's cold wake: the unit runs `binaryPath daemon run` for `agentDir`. Linux and macOS only. */
export function coldWakeSetup(options: {
  readonly binaryPath: string
  readonly agentDir: string
  readonly platform?: NodeJS.Platform
  readonly env?: Readonly<Record<string, string | undefined>>
}): ColdWake {
  const platform = options.platform ?? process.platform
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined
  if ((platform !== "linux" && platform !== "darwin") || uid === undefined)
    return { install: async () => UNSUPPORTED, uninstall: async () => UNSUPPORTED }
  const host = { platform, home: homedir(), uid, run: runCommand, pause }
  return {
    install: async () => {
      let launch: SessionHostLaunch
      try {
        launch = SessionHostLaunch.from({
          omoBin: options.binaryPath,
          execPath: process.execPath,
          agentDir: options.agentDir,
          path: (options.env ?? process.env).PATH,
        })
      } catch (error) {
        if (error instanceof ColdWakeUnitError) return { kind: "failed", step: "unit", detail: error.message }
        throw error
      }
      return installColdWake(host, launch)
    },
    uninstall: () => uninstallColdWake(host),
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

export async function applyColdWake(
  coldWake: ColdWake,
  enabled: boolean,
  error: (line: string) => void,
): Promise<ColdWakeOutcome> {
  const outcome = await (enabled ? coldWake.install() : coldWake.uninstall())
  const notice = coldWakeNotice(outcome)
  if (notice !== undefined) error(notice)
  return outcome
}
