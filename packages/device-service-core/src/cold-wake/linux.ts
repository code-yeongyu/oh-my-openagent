import { existsSync } from "node:fs"
import { join } from "node:path"

import { type ColdWakeHost, type ColdWakeOutcome, failed, removeIfPresent, writeIfChanged } from "./host.ts"
import { drainPinnedHost } from "./pinned-host.ts"
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
const RELAYD_SYSTEMD_UNIT = "omo-relay-daemon.service"
const COLD_WAKE_DROP_IN = "50-omo-cold-wake.conf"

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

const showFields = (output: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    output
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]),
  )

// Enabled for the user's manager and started: each start runs the ensure once (oneshot). A changed unit is restarted
// onto its new text; an unchanged one is started again, which only reuses a running host.
async function runSessionHost(host: ColdWakeHost, unitChanged: boolean): Promise<ColdWakeOutcome | undefined> {
  const shown = await systemctl(host, "show", SESSION_HOST_SYSTEMD_UNIT, "-p", "UnitFileState", "-p", "ActiveState")
  if (shown.exitCode !== 0) return failed("unit_show", shown.output)
  const state = showFields(shown.output)
  const steps: string[] = []
  if (state["UnitFileState"] !== "enabled") steps.push("enable")
  if (unitChanged) steps.push("restart")
  else if (state["ActiveState"] !== "active" && state["ActiveState"] !== "activating") steps.push("start")
  for (const step of steps) {
    const result = await systemctl(host, step, SESSION_HOST_SYSTEMD_UNIT)
    if (result.exitCode !== 0) return failed(`unit_${step}`, result.output)
  }
  return undefined
}

export async function installLinux(host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> {
  const unitPath = join(unitDir(host.home), SESSION_HOST_SYSTEMD_UNIT)
  const unitChanged = writeIfChanged(unitPath, systemdSessionHostUnit(launch))
  const outcome = await applyTable(host, (raw) => withColdWake(raw, "linux"), unitChanged, "installed")
  if (outcome.kind === "failed") return outcome
  return (await runSessionHost(host, unitChanged)) ?? outcome
}

// `disable --now` stops only the unit's own process (KillMode=process), so the pinned host it started is drained next.
// Only when a unit was there: with no unit, no host is ours to end. The unit file goes only after the drain, so a
// failed drain is tried again by the next uninstall.
export async function uninstallLinux(host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> {
  const unitPath = join(unitDir(host.home), SESSION_HOST_SYSTEMD_UNIT)
  if (existsSync(unitPath)) {
    const disabled = await systemctl(host, "disable", "--now", SESSION_HOST_SYSTEMD_UNIT)
    if (disabled.exitCode !== 0) return failed("unit_disable", disabled.output)
    const drainFailure = await drainPinnedHost(host, launch)
    if (drainFailure !== undefined) return drainFailure
  }
  return applyTable(host, withoutColdWake, removeIfPresent(unitPath), "removed")
}
