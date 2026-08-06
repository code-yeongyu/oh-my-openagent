import { spawnSync } from "node:child_process"

export function killProcess(pid) {
  try {
    process.kill(pid, "SIGKILL")
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    throw error
  }
}

export async function terminateProcessTree(pid, operations = {}) {
  const platform = operations.platform ?? process.platform
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return { kind: "failed", pid, platform, status: null, error: "pid must be a positive safe integer" }
  }
  const processAlive = operations.isProcessAlive ?? isProcessAlive
  if (!processAlive(pid)) return { kind: "already-exited", pid, platform }

  if (platform === "win32") {
    const run = operations.spawnSync ?? spawnSync
    const result = run("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { encoding: "utf8" })
    const aliveAfter = processAlive(pid)
    if (result.status === 0 && !aliveAfter) return { kind: "terminated", pid, platform }
    return { kind: "failed", pid, platform, status: result.status ?? null, error: processTreeError(result) }
  }

  const signal = operations.processKill ?? process.kill.bind(process)
  try {
    signal(-pid, "SIGKILL")
  } catch (error) {
    if (isMissingProcess(error)) return { kind: "already-exited", pid, platform }
    return { kind: "failed", pid, platform, status: null, error: error instanceof Error ? error.message : String(error) }
  }
  const pause = operations.pause ?? delay
  const pollAttempts = operations.pollAttempts ?? 20
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    if (!processAlive(pid)) return { kind: "terminated", pid, platform }
    if (attempt + 1 < pollAttempts) await pause(10)
  }
  return { kind: "failed", pid, platform, status: null, error: "process group remained alive after SIGKILL" }
}

export async function killProcessGroup(pid, operations = {}) {
  const terminate = operations.terminateProcessTree
    ?? ((targetPid) => terminateProcessTree(targetPid, operations))
  return (await terminate(pid)).kind !== "failed"
}

export function createOwnedProcessRegistry() {
  const groupIds = new Set()
  return {
    onSpawn(pid) {
      groupIds.add(pid)
    },
    onClose(pid) {
      groupIds.delete(pid)
    },
    cleanup(operations = {}) {
      return cleanupProcessGroups(groupIds, operations)
    },
  }
}

export async function cleanupProcessGroups(groupIds, operations = {}) {
  const platform = operations.platform ?? process.platform
  if (platform === "win32") {
    const terminate = operations.terminateProcessTree
      ?? ((targetPid) => terminateProcessTree(targetPid, operations))
    let leaked = 0
    for (const groupId of groupIds) {
      if ((await terminate(groupId))?.kind === "failed") leaked += 1
    }
    return leaked
  }

  const listGroupPids = operations.listGroupPids ?? readProcessGroupPids
  const kill = operations.killProcess ?? killProcess
  let leaked = 0
  for (const groupId of groupIds) {
    const members = listGroupPids(groupId).filter((pid) => pid !== process.pid)
    for (const pid of members) kill(pid)
    leaked += listGroupPids(groupId).filter((pid) => pid !== process.pid).length
  }
  return leaked
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (isMissingProcess(error)) return false
    if (error instanceof Error && "code" in error && error.code === "EPERM") return true
    throw error
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function processTreeError(result) {
  if (result.error instanceof Error) return result.error.message
  const stderr = typeof result.stderr === "string" ? result.stderr.trim() : ""
  return stderr || `taskkill exited with status ${result.status ?? "unknown"}`
}

function isMissingProcess(error) {
  return error instanceof Error && "code" in error && error.code === "ESRCH"
}

function readProcessGroupPids(groupId) {
  const probe = spawnSync("pgrep", ["-g", String(groupId)], { encoding: "utf8" })
  return (probe.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => Number(line.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0)
}
