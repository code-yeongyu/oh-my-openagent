import { execFile } from "node:child_process"
import { readFile } from "../fs/resilient"
import { readDarwinProcessStartSeconds } from "./process-start-time"

function errorCode(error: unknown): string | undefined {
  if (!(error instanceof Error) || !("code" in error)) return undefined
  return typeof error.code === "string" ? error.code : undefined
}

async function execFileText(command: string, args: string[]): Promise<string | null> {
  return await new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout: 2_000 }, (error, stdout) => {
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
  // PowerShell can resolve CreationDate for any visible process.
  const value = await execFileText("powershell.exe", [
    "-NoProfile",
    "-Command",
    `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).StartTime.ToUniversalTime().ToString('o')`,
  ])
  return value === null ? null : `win32-creation-date:${value}`
}

export async function getProcessStartIdentity(pid: number): Promise<string | null> {
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
