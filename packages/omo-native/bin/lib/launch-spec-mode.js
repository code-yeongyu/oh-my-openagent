import { chmodSync, lstatSync, statSync } from "node:fs"
import { userInfo } from "node:os"
import { join } from "node:path"

export const LAUNCH_SPEC_FILENAME = "daemon-launch-spec.json"

// The task host refuses a spec another user could rewrite (senpi-task `rejectInsecureMode`):
// any group/world write bit, or an owner other than the current user.
const WRITABLE_BY_OTHERS = 0o022

function currentUid() {
  return process.getuid?.()
}

function isMissing(error) {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")
}

/**
 * npm and bun extract package files with the installing user's umask, so a `umask 002` install
 * leaves the spec 0664 and every task host start refuses it (#9208). Only the group/world write
 * bits are removed, only on a regular file this user owns; a symlink is never followed, so a link
 * (or a file owned by someone else) is left exactly as it is and the host still rejects it.
 */
export function normalizeLaunchSpecMode(pluginRoot, io = {}) {
  const path = join(pluginRoot, LAUNCH_SPEC_FILENAME)
  if ((io.platform ?? process.platform) === "win32") return { action: "skipped", path, reason: "win32" }
  let stat
  try {
    stat = (io.lstat ?? lstatSync)(path)
  } catch (error) {
    if (isMissing(error)) return { action: "skipped", path, reason: "missing" }
    throw error
  }
  if (!stat.isFile()) return { action: "left", path, reason: "not_regular_file" }
  const uid = io.getuid === undefined ? currentUid() : io.getuid()
  if (uid !== undefined && stat.uid !== uid) return { action: "left", path, reason: "foreign_owner" }
  const from = stat.mode & 0o7777
  if ((from & WRITABLE_BY_OTHERS) === 0) return { action: "unchanged", path }
  const to = from & ~WRITABLE_BY_OTHERS
  ;(io.chmod ?? chmodSync)(path, to)
  return { action: "normalized", path, from, to }
}

function ownerName() {
  try {
    return userInfo().username
  } catch {
    return "$USER"
  }
}

/**
 * The doctor view applies the task host's own rule (the reader follows symlinks), so it reports
 * exactly the specs the host would refuse: the ones a launch could not normalize.
 */
export function launchSpecDoctorLines(pluginRoot, io = {}) {
  if ((io.platform ?? process.platform) === "win32") return []
  const path = join(pluginRoot, LAUNCH_SPEC_FILENAME)
  let stat
  try {
    stat = (io.stat ?? statSync)(path)
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
  if (!stat.isFile()) return []
  const uid = io.getuid === undefined ? currentUid() : io.getuid()
  const impact = "the task host refuses it, so process-mode task children and every team_create fail"
  if (uid !== undefined && stat.uid !== uid) {
    return [`FAIL launch spec: launch_spec_insecure: ${path} is not owned by you (uid ${stat.uid}); ${impact}. Fix: reinstall omo as this user, or run: sudo chown ${ownerName()} ${path}`]
  }
  if ((stat.mode & WRITABLE_BY_OTHERS) !== 0) {
    const mode = (stat.mode & 0o777).toString(8)
    return [`FAIL launch spec: launch_spec_insecure: ${path} is group/world-writable (${mode}); ${impact}. Fix: chmod 644 ${path}`]
  }
  return []
}
