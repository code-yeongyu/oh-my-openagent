import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"

import { parsePosixProcessTable, parseWindowsProcessTable, type ProcessInfo } from "./process-table"

export interface ProcessKiller {
  readonly isAlive: (pid: number) => boolean | Promise<boolean>
  readonly kill: (pid: number) => Promise<void>
  readonly terminate: (pid: number) => Promise<void>
}

export interface ResolveWindowsSystemBinaryOptions {
  readonly env?: NodeJS.ProcessEnv
  readonly fileExists?: (path: string) => boolean
}

/** Backward-compatible aliases: the codegraph family was the first consumer. */
export type CodegraphProcessKiller = ProcessKiller
export const enumerateCodegraphProcesses = enumerateProcesses
export const createDefaultCodegraphProcessKiller = createDefaultProcessKiller

export function enumerateProcesses(platform: NodeJS.Platform = process.platform): Promise<ProcessInfo[]> {
  return platform === "win32" ? enumerateWindowsProcesses() : enumeratePosixProcesses()
}

export function createDefaultProcessKiller(platform: NodeJS.Platform = process.platform): ProcessKiller {
  return platform === "win32" ? createWindowsKiller() : createPosixKiller()
}

export function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return processKillErrorMeansAlive(error)
  }
}

const POWERSHELL_SYSTEM_SEGMENTS = ["WindowsPowerShell", "v1.0", "powershell.exe"] as const
const TASKKILL_SYSTEM_SEGMENTS = ["taskkill.exe"] as const

/**
 * Prefers the absolute %SystemRoot%\System32 location over a PATH lookup:
 * spawned daemons can run with a curated or mutated PATH where bare names
 * stop resolving (upstream #6747). Falls back to the bare name when
 * SystemRoot is unknown or the candidate file does not exist.
 */
export function resolveWindowsSystemBinary(
  bareName: string,
  systemRelativeSegments: readonly string[],
  options: ResolveWindowsSystemBinaryOptions = {},
): string {
  const env = options.env ?? process.env
  const fileExists = options.fileExists ?? existsSync
  const systemRoot = nonEmptyText(env.SystemRoot) ?? nonEmptyText(env.windir)
  if (systemRoot === undefined) return bareName
  const absolute = join(systemRoot, "System32", ...systemRelativeSegments)
  return fileExists(absolute) ? absolute : bareName
}

function enumeratePosixProcesses(): Promise<ProcessInfo[]> {
  return execFileText("ps", ["-eo", "pid=,ppid=,command="]).then(parsePosixProcessTable)
}

function enumerateWindowsProcesses(): Promise<ProcessInfo[]> {
  const command = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,ParentProcessId,CommandLine",
    "ConvertTo-Json -Compress -Depth 2",
  ].join(" | ")
  const powershell = resolveWindowsSystemBinary("powershell.exe", POWERSHELL_SYSTEM_SEGMENTS)
  return execFileText(powershell, ["-NoProfile", "-Command", command]).then(parseWindowsProcessTable)
}

function createPosixKiller(): ProcessKiller {
  return {
    isAlive: defaultIsProcessAlive,
    kill: (pid) => {
      process.kill(pid, "SIGKILL")
      return Promise.resolve()
    },
    terminate: (pid) => {
      process.kill(pid, "SIGTERM")
      return Promise.resolve()
    },
  }
}

function createWindowsKiller(): ProcessKiller {
  const taskkill = resolveWindowsSystemBinary("taskkill.exe", TASKKILL_SYSTEM_SEGMENTS)
  return {
    isAlive: defaultIsProcessAlive,
    kill: (pid) => execFileVoid(taskkill, ["/PID", String(pid), "/T", "/F"]),
    terminate: (pid) => execFileVoid(taskkill, ["/PID", String(pid), "/T"]),
  }
}

function execFileText(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(annotateLauncherFailure(command, error))
        return
      }
      resolvePromise(stdout)
    })
  })
}

function annotateLauncherFailure(command: string, error: Error): Error {
  const code = typeof error === "object" && "code" in error ? error.code : undefined
  if (code !== "ENOENT") return error
  return new Error(`process sweep could not launch "${command}": ${error.message}`, { cause: error })
}

function nonEmptyText(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value : undefined
}

function execFileVoid(command: string, args: readonly string[]): Promise<void> {
  return execFileText(command, args).then(() => undefined)
}

function processKillErrorMeansAlive(error: Error): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
  if (code === "ESRCH") return false
  if (code === "EPERM") return true
  return false
}
