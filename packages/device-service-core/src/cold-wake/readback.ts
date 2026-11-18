import { existsSync } from "node:fs"
import { join } from "node:path"

import type { ColdWakeHost } from "./host.ts"
import { serviceTableOf } from "./linux.ts"
import { readPinnedHost } from "./pinned-host.ts"
import { SERVICE_TABLE_ENV, withColdWake } from "./service-table.ts"
import { SESSION_HOST_LAUNCHD_LABEL, SESSION_HOST_SYSTEMD_UNIT, type SessionHostLaunch } from "./session-host-unit.ts"

// omo#13594: what `omo remote status` reads back about this device's two units, from the service manager itself (not
// from what omo last wrote): each unit's state, whether the session host is enabled and its host pinned, and whether
// the device service's table names the session host for a cold wake.

export type UnitState = "running" | "stopped" | "not_installed" | "unknown"

export type ColdWakeStatus = {
  readonly sessionHost: { readonly unit: string; readonly state: UnitState; readonly enabled: boolean }
  readonly pinnedHost: boolean | "unknown"
  readonly deviceService: { readonly unit: string; readonly state: UnitState }
  readonly coldWakeEntry: boolean | "unknown"
}

const RELAYD_SYSTEMD_UNIT = "omo-relay-daemon.service"
const RELAYD_LAUNCHD_LABEL = "ai.omo.relay-daemon"

const fields = (output: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    output
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  )

// `activating` is the session host's ensure running: the unit is up.
const systemdState = (shown: Readonly<Record<string, string>>): UnitState => {
  if (shown["LoadState"] === "not-found") return "not_installed"
  if (shown["ActiveState"] === "active" || shown["ActiveState"] === "activating") return "running"
  return shown["ActiveState"] === undefined ? "unknown" : "stopped"
}

async function readLinux(host: ColdWakeHost) {
  const show = async (unit: string, ...extra: string[]) => {
    const shown = await host.run([
      "systemctl",
      "--user",
      "show",
      unit,
      "-p",
      "LoadState",
      "-p",
      "ActiveState",
      ...extra,
    ])
    return shown.exitCode === 0 ? fields(shown.output) : {}
  }
  const sessionHost = await show(SESSION_HOST_SYSTEMD_UNIT, "-p", "UnitFileState")
  const relayd = await show(RELAYD_SYSTEMD_UNIT)
  const environment = await host.run([
    "systemctl",
    "--user",
    "show",
    RELAYD_SYSTEMD_UNIT,
    "-p",
    "Environment",
    "--value",
  ])
  return {
    sessionHost: {
      unit: SESSION_HOST_SYSTEMD_UNIT,
      state: systemdState(sessionHost),
      enabled: sessionHost["UnitFileState"] === "enabled",
    },
    // A unit whose latest ensure failed stays reported as such, even with a host up.
    ensureFailed: sessionHost["ActiveState"] === "failed",
    deviceService: { unit: RELAYD_SYSTEMD_UNIT, state: systemdState(relayd) },
    coldWakeEntry:
      environment.exitCode === 0
        ? withColdWake(serviceTableOf(environment.output), "linux").kind === "unchanged"
        : ("unknown" as const),
  }
}

async function readDarwin(host: ColdWakeHost) {
  const agents = join(host.home, "Library", "LaunchAgents")
  const job = async (label: string) => {
    if (!existsSync(join(agents, `${label}.plist`))) return { loaded: false, state: "not_installed" as const }
    const printed = await host.run(["launchctl", "print", `gui/${host.uid}/${label}`])
    if (printed.exitCode !== 0) return { loaded: false, state: "stopped" as const }
    const lastExit = /^\s*last exit code = (\d+)$/m.exec(printed.output)?.[1]
    return {
      loaded: true,
      state: /^\s*state = running$/m.test(printed.output) ? ("running" as const) : ("stopped" as const),
      exitedNonZero: lastExit !== undefined && lastExit !== "0",
    }
  }
  const sessionHost = await job(SESSION_HOST_LAUNCHD_LABEL)
  const relayd = await job(RELAYD_LAUNCHD_LABEL)
  const table = await host.run([
    "plutil",
    "-extract",
    `EnvironmentVariables.${SERVICE_TABLE_ENV}`,
    "raw",
    "-o",
    "-",
    join(agents, `${RELAYD_LAUNCHD_LABEL}.plist`),
  ])
  const raw = table.exitCode === 0 ? table.output.replace(/\n$/, "") : undefined
  return {
    // The job runs its ensure and exits: running only while that ensure runs, else readColdWake asks the host.
    sessionHost: { unit: SESSION_HOST_LAUNCHD_LABEL, state: sessionHost.state, enabled: sessionHost.loaded },
    ensureFailed: sessionHost.loaded && sessionHost.exitedNonZero,
    deviceService: { unit: RELAYD_LAUNCHD_LABEL, state: relayd.state },
    coldWakeEntry: relayd.state === "not_installed" ? false : withColdWake(raw, "darwin").kind === "unchanged",
  }
}

export async function readColdWake(host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeStatus> {
  const { ensureFailed, ...units } = host.platform === "darwin" ? await readDarwin(host) : await readLinux(host)
  const pinned = await readPinnedHost(host, launch)
  // The unit is one ensure per start, so between starts it is not active; the host its ensure started or reused runs.
  // When the host cannot be read, neither can that.
  const between = units.sessionHost.state === "stopped" && units.sessionHost.enabled && !ensureFailed
  const hostState: UnitState =
    typeof pinned !== "string" ? "unknown" : pinned === "none" ? units.sessionHost.state : "running"
  const sessionHost = between ? { ...units.sessionHost, state: hostState } : units.sessionHost
  return { ...units, sessionHost, pinnedHost: typeof pinned === "string" ? pinned === "pinned" : "unknown" }
}
