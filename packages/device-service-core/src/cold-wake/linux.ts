import { join } from "node:path"

import { type ColdWakeHost, type ColdWakeOutcome, failed, removeIfPresent, writeIfChanged } from "./host.ts"
import { SERVICE_TABLE_ENV, type TableEdit, withColdWake, withoutColdWake } from "./service-table.ts"
import {
  SESSION_HOST_SYSTEMD_UNIT,
  type SessionHostLaunch,
  systemdQuote,
  systemdSessionHostUnit,
} from "./session-host-unit.ts"

// Linux: the session host is a systemd user unit, and the table lives in a drop-in of the device service's unit. Its
// installer rewrites the unit file itself on every install and update but never a drop-in, and a drop-in leaves the
// unit's FragmentPath alone, so the installer still recognises its own registration.
export const RELAYD_SYSTEMD_UNIT = "omo-relay-daemon.service"
export const COLD_WAKE_DROP_IN = "50-omo-cold-wake.conf"

const unitDir = (home: string): string => join(home, ".config", "systemd", "user")
const dropInPath = (home: string): string => join(unitDir(home), `${RELAYD_SYSTEMD_UNIT}.d`, COLD_WAKE_DROP_IN)

const ESCAPES: Readonly<Record<string, string>> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"' }

/** `systemctl show -p Environment --value`: assignments split on spaces, each double-quoted with C escapes when needed. */
export const environmentAssignments = (shown: string): string[] => {
  const assignments: string[] = []
  let current = ""
  let started = false
  let quoted = false
  for (let index = 0; index < shown.length; index++) {
    const char = shown[index] ?? ""
    if (quoted && char === "\\") {
      const next = shown[++index] ?? ""
      if (next === "x") {
        current += String.fromCharCode(Number.parseInt(shown.slice(index + 1, index + 3), 16))
        index += 2
      } else current += ESCAPES[next] ?? next
    } else if (char === '"') {
      quoted = !quoted
      started = true
    } else if (!quoted && (char === " " || char === "\n")) {
      if (started) assignments.push(current)
      current = ""
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) assignments.push(current)
  return assignments
}

/** The table the device service starts with: the last assignment wins, as it does in systemd. */
export const serviceTableOf = (shown: string): string | undefined => {
  const prefix = `${SERVICE_TABLE_ENV}=`
  return environmentAssignments(shown)
    .filter((assignment) => assignment.startsWith(prefix))
    .at(-1)
    ?.slice(prefix.length)
}

const dropInText = (table: string): string =>
  `[Service]\nEnvironment=${systemdQuote(`${SERVICE_TABLE_ENV}=${table}`, false)}\n`

const systemctl = (host: ColdWakeHost, ...args: string[]) => host.run(["systemctl", "--user", ...args])

async function applyTable(
  host: ColdWakeHost,
  edit: (raw: string | undefined) => TableEdit,
  unitChanged: boolean,
  done: "installed" | "removed",
): Promise<ColdWakeOutcome> {
  const reload = async (): Promise<ColdWakeOutcome | undefined> => {
    const result = await systemctl(host, "daemon-reload")
    return result.exitCode === 0 ? undefined : failed("daemon_reload", result.output)
  }
  const load = await systemctl(host, "show", RELAYD_SYSTEMD_UNIT, "-p", "LoadState", "--value")
  if (load.exitCode !== 0) return failed("service_show", load.output)
  const environment =
    load.output.trim() === "loaded"
      ? await systemctl(host, "show", RELAYD_SYSTEMD_UNIT, "-p", "Environment", "--value")
      : undefined
  if (environment !== undefined && environment.exitCode !== 0) return failed("service_show", environment.output)
  const change = environment === undefined ? undefined : edit(serviceTableOf(environment.output))
  if (change?.kind === "changed") {
    if (change.value === undefined) removeIfPresent(dropInPath(host.home))
    else writeIfChanged(dropInPath(host.home), dropInText(change.value))
  }
  if (unitChanged || change?.kind === "changed") {
    const reloadFailure = await reload()
    if (reloadFailure !== undefined) return reloadFailure
  }
  if (change === undefined) return { kind: "service_not_installed" }
  if (change.kind === "invalid") return { kind: "table_invalid", reason: change.reason }
  if (change.kind === "unchanged") return { kind: done, serviceRestarted: false }
  const restart = await systemctl(host, "restart", RELAYD_SYSTEMD_UNIT)
  if (restart.exitCode !== 0) return failed("service_restart", restart.output)
  return { kind: done, serviceRestarted: true }
}

export const installLinux = (host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> =>
  applyTable(
    host,
    (raw) => withColdWake(raw, "linux"),
    writeIfChanged(join(unitDir(host.home), SESSION_HOST_SYSTEMD_UNIT), systemdSessionHostUnit(launch)),
    "installed",
  )

export const uninstallLinux = (host: ColdWakeHost): Promise<ColdWakeOutcome> =>
  applyTable(host, withoutColdWake, removeIfPresent(join(unitDir(host.home), SESSION_HOST_SYSTEMD_UNIT)), "removed")
