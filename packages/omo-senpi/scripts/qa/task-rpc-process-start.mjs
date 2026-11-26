// When a process was created, in epoch milliseconds, so the RPC driver can tell its own leaked child from an unrelated
// process that was handed the same pid after the child exited (#14529: Windows reuses pids within seconds).
import { readFileSync } from "node:fs"

// Linux reports start times in clock ticks since boot; USER_HZ is 100 on every architecture the kernel ships.
const LINUX_TICKS_PER_SECOND = 100
// 100 ns ticks between 1601-01-01 (FILETIME epoch) and 1970-01-01 (Unix epoch).
const FILETIME_UNIX_EPOCH_OFFSET = 116_444_736_000_000_000n

/**
 * Epoch ms at which `pid` was created, or null when the platform cannot say (no such process, a zombie, an
 * unreadable process). Every reader rounds DOWN (btime and darwin are whole seconds), so an error can only make a
 * process look older than it is.
 */
export async function readProcessStartMs(pid) {
  if (process.platform === "linux") return readLinuxStartMs(pid)
  if (process.platform === "win32") {
    const { readWin32ProcessCreationFiletime } = await import("../../../memory-core/src/locks/process-start-time.ts")
    const filetime = await readWin32ProcessCreationFiletime(pid)
    return filetime === null ? null : Number((filetime - FILETIME_UNIX_EPOCH_OFFSET) / 10_000n)
  }
  if (process.platform === "darwin") {
    const { readDarwinProcessStartSeconds } = await import("../../../memory-core/src/locks/process-start-time.ts")
    const seconds = await readDarwinProcessStartSeconds(pid)
    return seconds === null ? null : seconds * 1000
  }
  return null
}

function readLinuxStartMs(pid) {
  let stat
  let bootStat
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    bootStat = readFileSync("/proc/stat", "utf8")
  } catch {
    return null
  }
  const fields = stat
    .slice(stat.lastIndexOf(")") + 2)
    .trim()
    .split(/\s+/)
  // fields[0] is the state (Z: exited, not yet reaped); fields[19] is starttime, field 22 of proc(5).
  const startTicks = Number(fields[19])
  const bootSeconds = Number(/^btime (\d+)$/m.exec(bootStat)?.[1])
  if (fields[0] === "Z" || !Number.isFinite(startTicks) || !Number.isFinite(bootSeconds)) return null
  return bootSeconds * 1000 + Math.floor((startTicks * 1000) / LINUX_TICKS_PER_SECOND)
}
