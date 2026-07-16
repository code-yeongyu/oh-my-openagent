import { spawnSync } from "node:child_process"

export function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

export function killTree(pid) {
  spawnSync("pkill", ["-9", "-P", String(pid)])
  try {
    process.kill(pid, 9)
  } catch (error) {
    if (!isMissingProcess(error)) throw error
  }
}

function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}
