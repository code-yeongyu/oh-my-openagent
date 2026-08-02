import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { win32 as windowsPath } from "node:path"

export type ProcessStartIdentityDeps = {
  readonly execFileText?: (file: string, args: readonly string[]) => Promise<string>
  readonly platform?: NodeJS.Platform
  readonly readDarwinStartAbstime?: (pid: number) => Promise<string | null>
  readonly readText?: (path: string) => Promise<string>
  readonly systemRoot?: string
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
      const normalizedBootId = bootId.trim()
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(normalizedBootId)) return null
      const processStartTicks = parseLinuxProcessStartTicks(stat)
      return processStartTicks === null ? null : `linux:${normalizedBootId}:${processStartTicks}`
    }
    if (platform === "darwin") {
      const readStartAbstime = deps.readDarwinStartAbstime ?? readDarwinStartAbstime
      const startAbstime = await readStartAbstime(pid)
      return startAbstime === null ? null : `darwin:${startAbstime}`
    }
    if (platform === "win32") {
      const systemRoot = deps.systemRoot ?? process.env["SystemRoot"] ?? process.env["SYSTEMROOT"]
      if (systemRoot === undefined || !windowsPath.isAbsolute(systemRoot)) return null
      const powershellPath = windowsPath.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
      const execFileText = deps.execFileText ?? defaultExecFileText
      const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`
      const startTicks = (await execFileText(powershellPath, ["-NoProfile", "-Command", script])).trim()
      return /^\d+$/.test(startTicks) ? `win32:${startTicks}` : null
    }
    return null
  } catch {
    return null
  }
}

export function isProcessStartIdentity(value: unknown): value is string {
  if (typeof value !== "string") return false
  return /^linux:[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}:[1-9]\d*$/.test(value)
    || /^darwin:[1-9]\d*$/.test(value)
    || /^win32:[1-9]\d*$/.test(value)
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

async function readDarwinStartAbstime(pid: number): Promise<string | null> {
  const RUSAGE_INFO_V2 = 2
  const RUSAGE_INFO_V2_SIZE = 16 + (18 * 8)
  const PROCESS_START_ABSTIME_OFFSET = 16 + (8 * 8)
  const { dlopen, FFIType, ptr } = await import("bun:ffi")
  const libproc = dlopen("/usr/lib/libproc.dylib", {
    proc_pid_rusage: {
      args: [FFIType.i32, FFIType.i32, FFIType.ptr],
      returns: FFIType.i32,
    },
  })
  try {
    const rusageInfoV2 = new Uint8Array(RUSAGE_INFO_V2_SIZE)
    const result = libproc.symbols.proc_pid_rusage(pid, RUSAGE_INFO_V2, ptr(rusageInfoV2))
    if (result !== 0) return null
    const processStartAbstime = new DataView(rusageInfoV2.buffer).getBigUint64(PROCESS_START_ABSTIME_OFFSET, true)
    return processStartAbstime === 0n ? null : processStartAbstime.toString()
  } finally {
    libproc.close()
  }
}
