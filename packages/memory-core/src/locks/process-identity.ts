import { execFile } from "node:child_process"
import { readFile } from "../fs/resilient"
import { readDarwinProcessStartSeconds, readWin32ProcessCreationFiletime } from "./process-start-time"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function execFileText(command: string, args: string[]): Promise<string | null> {
  return await new Promise((resolve) => {
    // powershell.exe is a console-subsystem binary, and under a Node runtime (no bun:ffi, so the
    // kernel32 fast path below can never answer) this fallback runs on EVERY pid probe. Without
    // windowsHide each probe flashes a console Windows foregrounds, stealing focus (#8501).
    execFile(command, args, { encoding: "utf8", timeout: 2_000, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        resolve(null)
        return
      }
      const value = stdout.trim()
      resolve(value.length > 0 ? value : null)
    })
  })
}

async function readLinuxStartIdentity(pid: number): Promise<string | null> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8")
    const commandEnd = stat.lastIndexOf(")")
    if (commandEnd < 0) return null
    const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/)
    const startTicks = fieldsAfterCommand[19]
    return startTicks === undefined ? null : `linux-proc-start-ticks:${startTicks}`
  } catch {
    return null
  }
}

async function readWin32StartIdentity(pid: number): Promise<string | null> {
  if (getPidLiveness(pid) === "dead") return null
  const creationFiletime = await readWin32ProcessCreationFiletime(pid)
  if (creationFiletime !== null) return `win32-creation-filetime:${creationFiletime}`
  // Only when kernel32 is unreachable through bun:ffi: PowerShell can resolve CreationDate for any
  // visible process, at the cost of one process spawn under a 2 s budget per probe.
  const value = await execFileText("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToString('o')`,
  ])
  return value === null ? null : `win32-creation-date:${value}`
}

type ReadProcessStartIdentity = (pid: number) => Promise<string | null>

export function createProcessStartIdentityReader(
  read: ReadProcessStartIdentity,
  ownPid: number,
): ReadProcessStartIdentity {
  // Our own pid cannot be reused while this module is alive. Other owners must always
  // be re-probed: caching them would hide process exit or PID reuse from stale-lock recovery.
  let ownIdentity: Promise<string | null> | undefined
  return (pid) => {
    if (pid !== ownPid) return read(pid)
    ownIdentity ??= read(pid).then((identity) => {
      if (identity === null) ownIdentity = undefined
      return identity
    }, (error: unknown) => {
      ownIdentity = undefined
      throw error
    })
    return ownIdentity
  }
}

export const getProcessStartIdentity = createProcessStartIdentityReader(readProcessStartIdentity, process.pid)

async function readProcessStartIdentity(pid: number): Promise<string | null> {
  if (process.platform === "linux") return await readLinuxStartIdentity(pid)
  if (process.platform === "darwin" || process.platform === "freebsd") {
    if (getPidLiveness(pid) === "dead") return null
    const startSeconds = await readDarwinProcessStartSeconds(pid)
    if (startSeconds !== null) return `proc-start-epoch:${startSeconds}`
    const value = await execFileText("/bin/ps", ["-o", "lstart=", "-p", String(pid)])
    return value === null ? null : `ps-lstart:${value.replace(/\s+/g, " ")}`
  }
  if (process.platform === "win32") return await readWin32StartIdentity(pid)
  return null
}

function identityScheme(identity: string): string | null {
  const separator = identity.indexOf(":")
  return separator <= 0 ? null : identity.slice(0, separator)
}

// `ps -o lstart=` renders local time, so the same pid yields different bytes to two processes that
// disagree about the timezone, and a mismatch is what proves an owner dead. Comparing across schemes
// would therefore let a live owner's lock be stolen during an upgrade, so anything not directly
// comparable is reported as no conflict and the owner keeps its lock.
export function startIdentitiesConflict(recorded: string, actual: string): boolean {
  const recordedScheme = identityScheme(recorded)
  if (recordedScheme === null || recordedScheme !== identityScheme(actual)) return false
  return recorded !== actual
}

/**
 * Two start identities can be compared byte-for-byte only when the same reader produced them.
 * Scheme-less legacy values compare as raw strings so records written before schemes existed
 * keep their original meaning.
 */
export function startIdentitiesComparable(recorded: string, actual: string): boolean {
  return identityScheme(recorded) === identityScheme(actual)
}

export type ProcessLiveness = "alive" | "dead" | "unknown"

export function getPidLiveness(pid: number): ProcessLiveness {
  try {
    process.kill(pid, 0)
    return "alive"
  } catch (error) {
    const code = errorCode(error)
    if (code === "ESRCH") return "dead"
    if (code === "EPERM") return "alive"
    return "unknown"
  }
}
