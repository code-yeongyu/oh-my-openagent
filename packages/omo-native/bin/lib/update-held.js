// @ts-check
// install.update on Windows when the package manager could not replace a held file (#10090): who holds it, what is
// installed now, and one reinstall of the previous version only when no install can be read any more.

import { dirname } from "node:path"
import { packageRoot } from "./package-paths.js"
import { findHolders, heldTarget, listWindowsProcesses, LOCK_RETRY_DELAYS_MS } from "./update-lock.js"

/**
 * @typedef {import("./install-calls.js").ChildResult} ChildResult
 * @typedef {import("./install-calls.js").Installed} Installed
 * @typedef {import("./install-calls.js").UpdateTarget} UpdateTarget
 * @typedef {import("./install-calls.js").UpdatePorts} UpdatePorts
 * @typedef {import("./install-calls.js").UpdateProgress} UpdateProgress
 * @typedef {import("./install-calls.js").Holder} Holder
 */

/** @param {() => Installed} readInstalled */
function readInstalledOrUndefined(readInstalled) {
  try {
    return readInstalled()
  } catch {
    return undefined
  }
}

/**
 * On Windows a file the manager could not replace: who holds it, what is installed now, and, only when no install can
 * be read any more, one reinstall of the previous version.
 * @param {{ result: ChildResult, before: Installed, install: (spec: UpdateTarget) => Promise<ChildResult>,
 *   resolveUpdate: (version?: string) => UpdateTarget, readInstalled: () => Installed, ports: UpdatePorts,
 *   progress: (event: UpdateProgress) => void }} input
 */
export async function heldInstall({ result, before, install, resolveUpdate, readInstalled, ports, progress }) {
  const file = heldTarget(result.stderr)
  const listProcesses = ports.listProcesses ?? listWindowsProcesses
  const installDir = ports.installDir ?? dirname(packageRoot)
  const selfPids = ports.selfPids ?? [process.pid, process.ppid]
  /** @type {Holder[]} */
  const holders = findHolders(installDir, listProcesses(), selfPids, file).map((holder) => ({
    name: holder.name,
    pid: holder.pid,
  }))
  progress({ kind: "held", file, attempts: LOCK_RETRY_DELAYS_MS.length + 1, holders })
  const now = readInstalledOrUndefined(readInstalled)
  const named = file === undefined ? {} : { file }
  if (now !== undefined)
    return { ...named, holders, restore: /** @type {const} */ ("not_needed"), installed_now: now.omo }
  // Any readable omo is a working install, even when the pinned target is unknown (registry down): the manager can
  // fail moving an old dependency after the new omo-ai is in place, and reinstalling over it would undo a working
  // update and hit the same held file. Only an unreadable install is restored.
  const previous = resolveUpdate(before.omo)
  let restored
  try {
    restored = await install(previous)
  } catch {
    restored = { status: 1, signal: null }
  }
  const after = readInstalledOrUndefined(readInstalled)
  const back = (restored.status ?? 1) === 0 && !restored.signal && after?.omo === before.omo
  return {
    ...named,
    holders,
    restore: /** @type {"restored" | "failed"} */ (back ? "restored" : "failed"),
    previous_command: previous.command,
  }
}
