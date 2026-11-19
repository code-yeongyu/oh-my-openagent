import { existsSync } from "node:fs"
import { join } from "node:path"

import { type ColdWakeHost, type ColdWakeOutcome, failed, removeIfPresent, writeIfChanged } from "./host.ts"
import { drainPinnedHost } from "./pinned-host.ts"
import { SERVICE_TABLE_ENV, type TableEdit, withColdWake, withoutColdWake } from "./service-table.ts"
import { launchdSessionHostPlist, SESSION_HOST_LAUNCHD_LABEL, type SessionHostLaunch } from "./session-host-unit.ts"

// macOS: the session host is a LaunchAgent in the user's GUI domain, and the table lives in the device service's own
// plist (launchd has no drop-ins). The device service's installer rewrites that plist on every install and update and
// drops the table, so every bootstrap checks it and writes it back (the installer carrying it forward is tracked with
// the device service). plutil edits the plist in place and keeps it XML, which the installer reads as text.
const RELAYD_LAUNCHD_LABEL = "ai.omo.relay-daemon"

const TABLE_KEY = `EnvironmentVariables.${SERVICE_TABLE_ENV}`
const BOOTSTRAP_ATTEMPTS = 5
const BOOTSTRAP_RETRY_MS = 1_000

export const plistPath = (home: string, label: string): string =>
  join(home, "Library", "LaunchAgents", `${label}.plist`)

/** `launchctl bootstrap` right after a bootout can fail while launchd still tears the job down: retried, as the installer does. */
export async function bootstrapJob(host: ColdWakeHost, plist: string) {
  let result = await host.run(["launchctl", "bootstrap", `gui/${host.uid}`, plist])
  for (let attempt = 1; attempt < BOOTSTRAP_ATTEMPTS && result.exitCode !== 0; attempt++) {
    await host.pause(BOOTSTRAP_RETRY_MS)
    result = await host.run(["launchctl", "bootstrap", `gui/${host.uid}`, plist])
  }
  return result
}

async function writeTable(host: ColdWakeHost, plist: string, value: string | undefined) {
  if (value === undefined) return host.run(["plutil", "-remove", TABLE_KEY, plist])
  const environment = await host.run(["plutil", "-extract", "EnvironmentVariables", "xml1", "-o", "-", plist])
  if (environment.exitCode !== 0) {
    const inserted = await host.run(["plutil", "-insert", "EnvironmentVariables", "-dictionary", plist])
    if (inserted.exitCode !== 0) return inserted
  }
  return host.run(["plutil", "-replace", TABLE_KEY, "-string", value, plist])
}

async function applyTable(
  host: ColdWakeHost,
  edit: (raw: string | undefined) => TableEdit,
  done: "installed" | "removed",
): Promise<ColdWakeOutcome> {
  const plist = plistPath(host.home, RELAYD_LAUNCHD_LABEL)
  if (!existsSync(plist)) return { kind: "service_not_installed" }
  // `raw` prints the value and a newline, and exits non-zero when there is no value at the key path.
  const read = await host.run(["plutil", "-extract", TABLE_KEY, "raw", "-o", "-", plist])
  const change = edit(read.exitCode === 0 ? read.output.replace(/\n$/, "") : undefined)
  if (change.kind === "invalid") return { kind: "table_invalid", reason: change.reason }
  if (change.kind === "unchanged") return { kind: done, serviceRestarted: false }
  const written = await writeTable(host, plist, change.value)
  if (written.exitCode !== 0) return failed("table_write", written.output)
  // launchd keeps the environment it loaded: only a bootout and a fresh bootstrap start the job with the new table.
  await host.run(["launchctl", "bootout", `gui/${host.uid}/${RELAYD_LAUNCHD_LABEL}`])
  const loaded = await bootstrapJob(host, plist)
  if (loaded.exitCode !== 0) return failed("service_restart", loaded.output)
  return { kind: done, serviceRestarted: true }
}

export async function installDarwin(host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> {
  const plist = plistPath(host.home, SESSION_HOST_LAUNCHD_LABEL)
  const job = `gui/${host.uid}/${SESSION_HOST_LAUNCHD_LABEL}`
  const changed = writeIfChanged(plist, launchdSessionHostPlist(launch))
  // A bootout fails when the job is not loaded, which is the state it is meant to reach.
  if (changed) await host.run(["launchctl", "bootout", job])
  if (changed || (await host.run(["launchctl", "print", job])).exitCode !== 0) {
    // A job someone disabled refuses a bootstrap; RunAtLoad starts it once it is loaded.
    await host.run(["launchctl", "enable", job])
    const loaded = await bootstrapJob(host, plist)
    if (loaded.exitCode !== 0) return failed("unit_load", loaded.output)
  } else {
    // Loaded and unchanged: run its ensure again (it reuses a running host), as Linux starts its oneshot unit.
    const kicked = await host.run(["launchctl", "kickstart", job])
    if (kicked.exitCode !== 0) return failed("unit_start", kicked.output)
  }
  return applyTable(host, (raw) => withColdWake(raw, "darwin"), "installed")
}

// The bootout leaves the host the job started (AbandonProcessGroup), so the pinned one is drained next. Only when a
// LaunchAgent was there: with none, no host is ours to end. The plist goes only after the drain, so a failed drain is
// tried again by the next uninstall.
export async function uninstallDarwin(host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> {
  const plist = plistPath(host.home, SESSION_HOST_LAUNCHD_LABEL)
  if (existsSync(plist)) {
    await host.run(["launchctl", "bootout", `gui/${host.uid}/${SESSION_HOST_LAUNCHD_LABEL}`])
    const drainFailure = await drainPinnedHost(host, launch)
    if (drainFailure !== undefined) return drainFailure
    removeIfPresent(plist)
  }
  return applyTable(host, withoutColdWake, "removed")
}
