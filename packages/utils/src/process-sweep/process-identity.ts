import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"

export type ProcessStartIdentityDeps = {
  readonly execFileText?: (file: string, args: readonly string[]) => Promise<string>
  readonly platform?: NodeJS.Platform
  readonly readText?: (path: string) => Promise<string>
}

export async function readProcessStartIdentity(
  pid: number,
  deps: ProcessStartIdentityDeps = {},
): Promise<string | null> {
  try {
    const platform = deps.platform ?? process.platform
    if (platform === "linux") {
      const readText = deps.readText ?? ((path: string) => readFile(path, "utf8"))
      const [bootId, stat] = await Promise.all([
        readText("/proc/sys/kernel/random/boot_id"),
        readText(`/proc/${pid}/stat`),
      ])
      const processStartTicks = parseLinuxProcessStartTicks(stat)
      return processStartTicks === null ? null : `linux:${bootId.trim()}:${processStartTicks}`
    }
    const execFileText = deps.execFileText ?? defaultExecFileText
    if (platform === "win32") {
      const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
      const startTicks = (await execFileText("powershell.exe", ["-NoProfile", "-Command", script])).trim()
      return /^\d+$/.test(startTicks) ? `win32:${startTicks}` : null
    }
    const startedAt = (await execFileText("ps", ["-p", String(pid), "-o", "lstart="])).trim()
    return startedAt.length > 0 ? `${platform}:${startedAt}` : null
  } catch (error) {
    if (error instanceof Error) return null
    throw error
  }
}

export function parseLinuxProcessStartTicks(stat: string): string | null {
  const commandEnd = stat.lastIndexOf(")")
  if (commandEnd < 0) return null
  const fieldsAfterCommand = stat.slice(commandEnd + 1).trim().split(/\s+/)
  const startTicks = fieldsAfterCommand[19]
  return startTicks !== undefined && /^\d+$/.test(startTicks) ? startTicks : null
}

function defaultExecFileText(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(file, [...args], { encoding: "utf8", windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolvePromise(stdout)
    })
  })
}
