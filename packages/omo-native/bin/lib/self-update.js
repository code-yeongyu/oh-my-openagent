import { dirname, join } from "node:path"
import { runChild } from "./child-process.js"
import { fetchNpmDistTagsSync } from "./npm-dist-tags.js"
import { channelDistTagVersion, channelPackageSpec, packageManifest, packageRoot, readJson, releaseChannel, resolveSenpi, updateTarget } from "./package-paths.js"
import { isPrintOnlyUpdate, updateUsageAnswer } from "./update-args.js"
import { findHolders, heldTarget, isLockFailure, listWindowsProcesses, LOCK_RETRY_DELAYS_MS } from "./update-lock.js"

export { isPrintOnlyUpdate }

export function formatUpdateCommand(update) {
  return `omo is updated via ${update.manager}: ${update.command}`
}

export function readInstalledVersion() {
  let engine = "unknown"
  try {
    engine = readJson(join(resolveSenpi().packageRoot, "package.json")).version
  } catch {
    // The product version is still reportable when the engine tree cannot be resolved.
  }
  return { omo: packageManifest().version, engine }
}

export function formatVersionChange(before, after) {
  return `omo ${before.omo} -> ${after.omo} (engine: senpi ${after.engine})`
}

/**
 * Resolves the version the running build's channel dist-tag names (the lookup `omo doctor` uses for
 * "Latest"), then prints and optionally runs the package-manager command that installs exactly that
 * version. `--help`/`-h` print the usage and an unknown flag exits 2, both before the registry lookup,
 * so neither can install anything (#9207). `--dry-run` and `--print` print the resolved command only.
 * Already on the target, it says so and installs nothing. After a manager exit 0 it re-reads the installed version: one that did not
 * reach the target exits non-zero with the retry command, because the manager's own success does not
 * prove the install moved (#9198). An unreachable registry falls back to the unpinned channel spec.
 * `run` defaults to `runChild` so tests inject a spawn without touching the child-process helper.
 *
 * On Windows a manager failure whose stderr says a file is held (EPERM/EBUSY, #10090) is retried with
 * backoff. If the file stays held, the report names the file, the processes of this install that hold it
 * and one action, and only an install that can no longer be read is reinstalled at the previous version; any readable version is kept.
 *
 * @typedef {{ omo: string, engine: string }} InstalledVersion
 * @typedef {{ status: number | null, signal: string | null, stderr?: string }} ChildResult
 * @typedef {{ stdio?: "inherit", windowsHide?: boolean, env?: NodeJS.ProcessEnv, captureStderr?: boolean }} RunOptions
 * @typedef {import("./update-lock.js").ProcessEntry} ProcessEntry
 * @typedef {{ manager: string, command: string, argv: string[], env?: Record<string, string> }} UpdateTarget
 * @typedef {{
 *   resolveUpdate?: (targetVersion?: string) => UpdateTarget,
 *   fetchDistTags?: () => Record<string, unknown> | null,
 *   log?: (line: string) => void,
 *   error?: (line: string) => void,
 *   run?: (command: string, args: string[], options?: RunOptions) => Promise<ChildResult>,
 *   readInstalled?: () => InstalledVersion,
 *   env?: NodeJS.ProcessEnv,
 *   platform?: NodeJS.Platform,
 *   sleep?: (ms: number) => Promise<void>,
 *   listProcesses?: () => ProcessEntry[],
 *   installDir?: string,
 *   selfPids?: number[],
 * }} SelfUpdateOptions
 * @param {string[]} args
 * @param {SelfUpdateOptions} [options]
 * @returns {Promise<number>}
 */
export async function runSelfUpdate(args, options = {}) {
  const resolveUpdate = options.resolveUpdate
    ?? ((targetVersion) => updateTarget(undefined, undefined, undefined, undefined, undefined, targetVersion))
  const fetchDistTags = options.fetchDistTags ?? fetchNpmDistTagsSync
  const log = options.log ?? ((line) => console.log(line))
  const error = options.error ?? ((line) => console.error(line))
  const run = options.run ?? runChild
  const readInstalled = options.readInstalled ?? readInstalledVersion
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))

  const usage = updateUsageAnswer(args)
  if (usage !== undefined) {
    ;(usage.stream === "stderr" ? error : log)(usage.text)
    return usage.exitCode
  }

  const before = readInstalled()
  const channel = releaseChannel(before.omo)
  const target = channelDistTagVersion(fetchDistTags(), before.omo)
  const update = resolveUpdate(target)

  if (target === undefined) {
    log(`omo: could not confirm the ${channel} omo-ai version from the npm registry; installing the unpinned ${channelPackageSpec(before.omo)}`)
  }
  if (isPrintOnlyUpdate(args)) {
    log(formatUpdateCommand(update))
    return 0
  }
  if (target !== undefined && target === before.omo) {
    log(`omo ${before.omo} is up to date (omo-ai@${channel} is ${target})`)
    return 0
  }
  log(formatUpdateCommand(update))

  const install = async (target) => {
    const [command, ...argv] = target.argv
    return run(command, argv, {
      stdio: "inherit",
      windowsHide: true,
      env: { ...env, ...target.env },
      captureStderr: platform === "win32",
    })
  }
  const failed = (result) => Boolean(result.signal) || (result.status ?? 1) !== 0
  const heldOnWindows = (result) => platform === "win32" && !result.signal && isLockFailure(result.stderr)

  let result
  for (let attempt = 0; ; attempt += 1) {
    try {
      result = await install(update)
    } catch {
      error(`omo: update failed; retry with: ${update.command}`)
      return 1
    }
    if (!failed(result) || !heldOnWindows(result) || attempt >= LOCK_RETRY_DELAYS_MS.length) break
    const delay = LOCK_RETRY_DELAYS_MS[attempt]
    log(`omo: ${heldTarget(result.stderr) ?? "a package file"} is held by another process; retrying in ${delay / 1000}s (attempt ${attempt + 2} of ${LOCK_RETRY_DELAYS_MS.length + 1})`)
    await sleep(delay)
  }

  if (failed(result) && heldOnWindows(result)) {
    await reportHeldInstall({ result, before, install, resolveUpdate, readInstalled, error, options, attempts: LOCK_RETRY_DELAYS_MS.length + 1 })
    return 1
  }
  if (failed(result)) {
    error(`omo: update failed; retry with: ${update.command}`)
    return result.status ?? 1
  }

  const after = readInstalled()
  if (target !== undefined && after.omo !== target) {
    error(`omo is still ${after.omo}; ${target} is published`)
    error(`omo: update failed; retry with: ${update.command}`)
    return 1
  }
  log(formatVersionChange(before, after))
  return 0
}

function readInstalledOrUndefined(readInstalled) {
  try {
    return readInstalled()
  } catch {
    return undefined
  }
}

async function reportHeldInstall({ result, before, install, resolveUpdate, readInstalled, error, options, attempts }) {
  const held = heldTarget(result.stderr)
  const file = held ?? "a package file"
  const listProcesses = options.listProcesses ?? listWindowsProcesses
  const installDir = options.installDir ?? dirname(packageRoot)
  const selfPids = options.selfPids ?? [process.pid, process.ppid]
  const holders = findHolders(installDir, listProcesses(), selfPids, held)

  error(`omo: update stopped: Windows would not let the package manager replace ${file}; it was still held after ${attempts} attempts.`)
  if (holders.length > 0) {
    error(`omo: held by ${holders.map((holder) => `${holder.name} (pid ${holder.pid})`).join(", ")}`)
    const names = [...new Set(holders.map((holder) => holder.name))].join(", ")
    error(`omo: Quit ${names} and run omo update again.`)
  } else {
    error("omo: No omo command-line process was found holding it. Another app (for example the OmO desktop app or an editor) or antivirus may be holding it: close it, or wait a minute, then run omo update again.")
  }

  const now = readInstalledOrUndefined(readInstalled)
  if (now?.omo === before.omo) {
    error(`omo: omo ${before.omo} is still installed.`)
    return
  }
  // Any readable omo is a working install, even when the pinned target is unknown (registry down): the
  // manager can fail moving an old dependency after the new omo-ai is in place, and reinstalling over it
  // would undo a working update and hit the same held file. Only an unreadable install is restored.
  if (now !== undefined) {
    error(`omo: omo ${now.omo} is installed, but the package manager did not finish; run omo update again afterwards to complete it.`)
    return
  }
  const previous = resolveUpdate(before.omo)
  let restored
  try {
    restored = await install(previous)
  } catch {
    restored = { status: 1, signal: null }
  }
  const after = readInstalledOrUndefined(readInstalled)
  if ((restored.status ?? 1) === 0 && !restored.signal && after?.omo === before.omo) {
    error(`omo: restored omo ${before.omo}.`)
    return
  }
  const when = holders.length > 0 ? "after quitting the holder" : "once the file is released"
  error(`omo: the previous omo ${before.omo} could not be restored; ${when}, run: ${previous.command}`)
}
