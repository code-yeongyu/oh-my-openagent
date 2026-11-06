import { readdirSync, renameSync, rmSync } from "node:fs"
import { join, sep } from "node:path"
import { listProcesses } from "./bin/lib/doctor.js"
import { RELEASE_VERSION } from "./compiled-update"

// Every release provisions ~/.omo/binary-runtime/<version>/ (~250MB) and nothing removed the old ones,
// so a standalone install grew by one runtime per update. A launch prunes the versions older than its
// own, keeping the newest older one for a rollback and any runtime a live process runs.
export const RETAINED_PREVIOUS_RUNTIMES = 1
const PRUNE_PREFIX = ".prune-"

export type RuntimePruneResult = {
  readonly removed: readonly string[]
  /** Older runtimes left in place: the retained rollback runtime and every runtime still in use. */
  readonly kept: readonly string[]
  readonly failed: readonly { readonly version: string; readonly reason: string }[]
}

/**
 * Command lines of the processes running on this machine, or undefined when they cannot be listed.
 * An unknown answer prunes nothing: deleting the runtime of a live session would break it mid-run.
 */
export type ListRunningCommands = () => readonly string[] | undefined

export function pruneProvisionedRuntimes(options: {
  readonly root: string
  readonly current: string
  readonly platform?: NodeJS.Platform
  readonly listRunning?: ListRunningCommands
}): RuntimePruneResult {
  const platform = options.platform ?? process.platform
  const result = { removed: [] as string[], kept: [] as string[], failed: [] as { version: string; reason: string }[] }
  let entries: string[]
  try {
    entries = readdirSync(options.root)
  } catch {
    return result
  }
  // A prune interrupted between its rename and its delete leaves a renamed tree that nothing runs from.
  for (const entry of entries.filter((name) => name.startsWith(PRUNE_PREFIX))) {
    try {
      rmSync(join(options.root, entry), { recursive: true, force: true })
    } catch {
      // Still held (a Windows handle closes late); the next prune retries it.
    }
  }
  const older = entries
    .filter((name) => RELEASE_VERSION.test(name) && Bun.semver.order(name, options.current) < 0)
    .sort((left, right) => Bun.semver.order(right, left))
  result.kept.push(...older.slice(0, RETAINED_PREVIOUS_RUNTIMES))
  const candidates = older.slice(RETAINED_PREVIOUS_RUNTIMES)
  if (candidates.length === 0) return result
  // Windows refuses to rename a directory while a file inside it is open, which covers a running
  // runtime without a CIM query that costs seconds on every launch.
  const running = platform === "win32" ? [] : (options.listRunning ?? listRunningCommands)()
  if (running === undefined) {
    result.kept.push(...candidates)
    return result
  }
  for (const version of candidates) {
    const directory = join(options.root, version)
    // The launcher execs the runtime by its absolute path, so argv[0] starts with the runtime directory.
    if (running.some((command) => command.startsWith(`${directory}${sep}`))) {
      result.kept.push(version)
      continue
    }
    // Rename first so a launch of this version that races the delete re-provisions a whole runtime
    // instead of running from a half-deleted one.
    const pruning = join(options.root, `${PRUNE_PREFIX}${version}-${process.pid}`)
    try {
      renameSync(directory, pruning)
    } catch (error) {
      result.kept.push(version)
      if (!(platform === "win32" && isBusy(error))) result.failed.push({ version, reason: errorMessage(error) })
      continue
    }
    try {
      rmSync(pruning, { recursive: true, force: true })
      result.removed.push(version)
    } catch (error) {
      result.failed.push({ version, reason: errorMessage(error) })
    }
  }
  return result
}

/**
 * The Windows replace command `omo update` prints moves the running launcher aside to `<launcher>.old`,
 * because Windows cannot overwrite a running executable. A launch of the new version removes it.
 */
export function removeReplacedLauncher(launcher: string, platform: NodeJS.Platform = process.platform): void {
  if (platform !== "win32") return
  try {
    rmSync(`${launcher}.old`, { force: true })
  } catch {
    // A session started from the old launcher still holds it; a later launch retries.
  }
}

// doctor's `ps` listing; an empty one never comes from a real host (this process is running).
function listRunningCommands(): readonly string[] | undefined {
  const commands = listProcesses().map((entry: { command: string }) => entry.command)
  return commands.length === 0 ? undefined : commands
}

function isBusy(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === "EBUSY" || code === "EPERM" || code === "EACCES"
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
