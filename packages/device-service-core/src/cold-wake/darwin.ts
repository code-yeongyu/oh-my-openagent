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
const UNLOAD_POLLS = 100
const UNLOAD_POLL_MS = 100
// OmO Desktop started its reinstall 0.24 s and 0.8 s after omo's bootout in omo#14069 and rewrote the plist first.
const SETTLE_POLLS = 30
const SETTLE_POLL_MS = 100

const plistPath = (home: string, label: string): string => join(home, "Library", "LaunchAgents", `${label}.plist`)

type JobState = { readonly kind: "absent" } | { readonly kind: "loaded"; readonly pid: string | undefined }

/** `launchctl print` exits 0 for a loaded job and shows "pid = <n>" while it runs a process. */
async function jobState(host: ColdWakeHost, job: string): Promise<JobState> {
  const print = await host.run(["launchctl", "print", job])
  if (print.exitCode !== 0) return { kind: "absent" }
  return { kind: "loaded", pid: /^\s*pid = (\d+)\s*$/m.exec(print.output)?.[1] }
}

type JobUnload =
  | { readonly kind: "unloaded" }
  | { readonly kind: "loaded_by_another" }
  | { readonly kind: "stuck"; readonly output: string }

/**
 * Boots `job` out and waits until launchd has unloaded it: bootout returns before the old job is gone, and a bootstrap
 * before then fails with "5: Input/output error". A job that shows a process other than the one it ran before the
 * bootout was loaded again by another writer (omo#14069); one still loaded after the wait is stuck.
 */
async function unloadJob(host: ColdWakeHost, job: string): Promise<JobUnload> {
  const before = await jobState(host, job)
  if (before.kind === "absent") return { kind: "unloaded" }
  const bootout = await host.run(["launchctl", "bootout", job])
  for (let poll = 0; poll < UNLOAD_POLLS; poll++) {
    const now = await jobState(host, job)
    if (now.kind === "absent") return { kind: "unloaded" }
    if (now.pid !== undefined && now.pid !== before.pid) return { kind: "loaded_by_another" }
    await host.pause(UNLOAD_POLL_MS)
  }
  return { kind: "stuck", output: bootout.output.trim() || `${job} is still loaded after launchctl bootout` }
}

type JobLoad =
  | { readonly kind: "loaded" }
  | { readonly kind: "loaded_by_another" }
  | { readonly kind: "failed"; readonly output: string }

/**
 * Bootstraps `plist` as `job`, retried while launchd refuses it with the job still absent. A refusal with the job
 * loaded means another writer loaded it after the bootout, and a bootstrap can never succeed on a loaded job, so that
 * ends the attempts: the caller judges what the other writer loaded.
 */
async function loadJob(host: ColdWakeHost, job: string, plist: string): Promise<JobLoad> {
  let output = ""
  for (let attempt = 0; attempt < BOOTSTRAP_ATTEMPTS; attempt++) {
    if (attempt > 0) await host.pause(BOOTSTRAP_RETRY_MS)
    const result = await host.run(["launchctl", "bootstrap", `gui/${host.uid}`, plist])
    if (result.exitCode === 0) return { kind: "loaded" }
    if ((await jobState(host, job)).kind === "loaded") return { kind: "loaded_by_another" }
    output = result.output
  }
  return { kind: "failed", output }
}

const readTable = async (host: ColdWakeHost, plist: string): Promise<string | undefined> => {
  // `raw` prints the value and a newline, and exits non-zero when there is no value at the key path.
  const read = await host.run(["plutil", "-extract", TABLE_KEY, "raw", "-o", "-", plist])
  return read.exitCode === 0 ? read.output.replace(/\n$/, "") : undefined
}

/**
 * Whether the plist still holds `value` once the restart settles. A writer that saw the job stop (OmO Desktop reinstalls
 * the device service then) can replace it even after omo's own bootstrap, and its installer rewrites the plist first.
 */
async function tableSettles(host: ColdWakeHost, plist: string, value: string | undefined): Promise<boolean> {
  for (let poll = 0; poll < SETTLE_POLLS; poll++) {
    await host.pause(SETTLE_POLL_MS)
    if ((await readTable(host, plist)) !== value) return false
  }
  return true
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
  const change = edit(await readTable(host, plist))
  if (change.kind === "invalid") return { kind: "table_invalid", reason: change.reason }
  if (change.kind === "unchanged") return { kind: done, serviceRestarted: false }
  const written = await writeTable(host, plist, change.value)
  if (written.exitCode !== 0) return failed("table_write", written.output)
  // launchd keeps the environment it loaded: only a bootout and a fresh bootstrap start the job with the new table.
  const job = `gui/${host.uid}/${RELAYD_LAUNCHD_LABEL}`
  const unload = await unloadJob(host, job)
  if (unload.kind === "stuck") return failed("service_restart", unload.output)
  const load = unload.kind === "loaded_by_another" ? unload : await loadJob(host, job, plist)
  switch (load.kind) {
    case "loaded":
      return (await tableSettles(host, plist, change.value))
        ? { kind: done, serviceRestarted: true }
        : { kind: "service_replaced" }
    case "failed":
      return failed("service_restart", load.output)
    case "loaded_by_another":
      // omo#14069: OmO Desktop reinstalls the device service when it stops, and that installer rewrites this plist from
      // its own environment before it loads the job. The job it loaded carries the table only if the plist still does.
      return (await readTable(host, plist)) === change.value
        ? { kind: done, serviceRestarted: true }
        : { kind: "service_replaced" }
  }
}

export async function installDarwin(host: ColdWakeHost, launch: SessionHostLaunch): Promise<ColdWakeOutcome> {
  const plist = plistPath(host.home, SESSION_HOST_LAUNCHD_LABEL)
  const job = `gui/${host.uid}/${SESSION_HOST_LAUNCHD_LABEL}`
  const changed = writeIfChanged(plist, launchdSessionHostPlist(launch))
  if (changed) {
    const unload = await unloadJob(host, job)
    if (unload.kind === "stuck") return failed("unit_load", unload.output)
  }
  if (changed || (await jobState(host, job)).kind === "absent") {
    // A job someone disabled refuses a bootstrap; RunAtLoad starts it once it is loaded.
    await host.run(["launchctl", "enable", job])
    // Only omo writes this plist, so a job loaded by another bootstrap runs the file just written.
    const load = await loadJob(host, job, plist)
    if (load.kind === "failed") return failed("unit_load", load.output)
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
