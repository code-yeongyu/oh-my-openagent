import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { bootstrapJob, plistPath } from "./darwin.ts"
import { type ColdWakeHost, type ColdWakeOutcome, failed, writeIfChanged } from "./host.ts"
import { readInstalledSessionHostUnit } from "./installed-unit.ts"
import { unitDir } from "./linux.ts"
import {
  ColdWakeUnitError,
  launchdSessionHostPlist,
  SESSION_HOST_LAUNCHD_LABEL,
  SESSION_HOST_SYSTEMD_UNIT,
  SessionHostLaunch,
  systemdSessionHostUnit,
} from "./session-host-unit.ts"

// The provisioned runtime a unit runs: `~/.omo/binary-runtime/<version>/omo`.
const RUNTIME_VERSION = /\/binary-runtime\/([^/]+)\/[^/]+$/

const INSTALLED: ColdWakeOutcome = { kind: "installed", serviceRestarted: false }

/**
 * omo#14191: a launch of a newer runtime brings an installed session host unit's program and shape forward - an older
 * omo's KeepAlive / Restart=always unit naming an older `binary-runtime/<version>/omo` - and nothing else. The agent dir
 * and PATH stay the installed unit's, so the launching process's environment never reaches the unit (#14194 review H1/M1).
 * Undefined, after one file read and no service manager call, when there is nothing to do: no unit (a refresh never
 * installs one), a unit no provisioned runtime owns, or one `isOlder` does not call older than this runtime.
 */
export async function refreshColdWake(
  host: ColdWakeHost,
  options: { readonly runtime: string; readonly isOlder: (installedRuntimeVersion: string) => boolean },
): Promise<ColdWakeOutcome | undefined> {
  const darwin = host.platform === "darwin"
  const path = darwin
    ? plistPath(host.home, SESSION_HOST_LAUNCHD_LABEL)
    : join(unitDir(host.home), SESSION_HOST_SYSTEMD_UNIT)
  if (!existsSync(path)) return undefined
  const installed = readInstalledSessionHostUnit(readFileSync(path, "utf8"), darwin)
  const version = installed === undefined ? undefined : RUNTIME_VERSION.exec(installed.program)?.[1]
  if (installed === undefined || version === undefined || !options.isOlder(version)) return undefined
  const agentDir = installed.env.get("OMO_CODING_AGENT_DIR")
  if (agentDir === undefined) return undefined
  let launch: SessionHostLaunch
  try {
    const unitPath = installed.env.get("PATH")
    launch = SessionHostLaunch.from({
      omoBin: options.runtime,
      execPath: options.runtime,
      agentDir,
      ...(unitPath === undefined ? {} : { path: unitPath }),
    })
  } catch (error) {
    if (error instanceof ColdWakeUnitError) return failed("unit", error.message)
    throw error
  }
  if (!writeIfChanged(path, darwin ? launchdSessionHostPlist(launch) : systemdSessionHostUnit(launch))) return undefined
  return darwin ? reloadDarwin(host, path) : reloadLinux(host)
}

// Loaded again only when enabled, and queued (`--no-block`): the launch never waits on the oneshot ensure, and a unit the
// user disabled stays disabled (#14194 review L2).
async function reloadLinux(host: ColdWakeHost): Promise<ColdWakeOutcome> {
  const systemctl = (...args: string[]) => host.run(["systemctl", "--user", ...args])
  const reloaded = await systemctl("daemon-reload")
  if (reloaded.exitCode !== 0) return failed("daemon_reload", reloaded.output)
  const shown = await systemctl("show", SESSION_HOST_SYSTEMD_UNIT, "-p", "UnitFileState")
  if (shown.exitCode !== 0) return failed("unit_show", shown.output)
  if (!/^UnitFileState=enabled$/m.test(shown.output)) return INSTALLED
  const restarted = await systemctl("--no-block", "restart", SESSION_HOST_SYSTEMD_UNIT)
  return restarted.exitCode === 0 ? INSTALLED : failed("unit_restart", restarted.output)
}

// A job the user disabled keeps its new plist on disk and is neither loaded nor enabled.
async function reloadDarwin(host: ColdWakeHost, plist: string): Promise<ColdWakeOutcome> {
  const domain = `gui/${host.uid}`
  const disabled = await host.run(["launchctl", "print-disabled", domain])
  if (new RegExp(`"${SESSION_HOST_LAUNCHD_LABEL.replaceAll(".", "\\.")}" => (disabled|true)`).test(disabled.output))
    return INSTALLED
  await host.run(["launchctl", "bootout", `${domain}/${SESSION_HOST_LAUNCHD_LABEL}`])
  const loaded = await bootstrapJob(host, plist)
  return loaded.exitCode === 0 ? INSTALLED : failed("unit_load", loaded.output)
}
