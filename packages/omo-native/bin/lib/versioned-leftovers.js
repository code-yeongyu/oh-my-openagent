import { readdirSync, rmSync } from "node:fs"
import { join } from "node:path"

// Every writer of a versions dir names its work `.stage-<version>-<pid>` and a rejected version
// `.failed-<version>-<epoch ms>`, so the pid says whether a stage is still being written.
const KEEP_FAILED = 2
const TRAILING_NUMBER = /-(\d+)$/

function trailingNumber(name) {
  const match = TRAILING_NUMBER.exec(name)
  return match === null ? undefined : Number(match[1])
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM"
  }
}

/**
 * Stage dirs another live process is filling for exactly this version.
 * @param {string} versionsDir
 * @param {string} target
 * @returns {string[]}
 */
export function liveForeignStages(versionsDir, target) {
  const prefix = `.stage-${target}-`
  return readdirSync(versionsDir)
    .filter((name) => name.startsWith(prefix) && /^\d+$/.test(name.slice(prefix.length)))
    .filter((name) => {
      const pid = Number(name.slice(prefix.length))
      return pid !== process.pid && pidAlive(pid)
    })
    .map((name) => join(versionsDir, name))
}

/**
 * Keeps the newest {@link KEEP_FAILED} `.failed-*` dirs and removes stages whose writer is gone; a live
 * stage (this process's included) is never touched.
 * @param {string} versionsDir
 */
export function pruneLeftovers(versionsDir) {
  const names = readdirSync(versionsDir)
  const failed = names
    .filter((name) => name.startsWith(".failed-"))
    .sort((a, b) => (trailingNumber(a) ?? 0) - (trailingNumber(b) ?? 0))
  const deadStages = names.filter((name) => {
    if (!name.startsWith(".stage-")) return false
    const pid = trailingNumber(name)
    return pid !== undefined && pid !== process.pid && !pidAlive(pid)
  })
  for (const name of [...failed.slice(0, -KEEP_FAILED), ...deadStages]) {
    rmSync(join(versionsDir, name), { recursive: true, force: true })
  }
}
