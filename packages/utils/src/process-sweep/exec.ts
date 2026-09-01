import { execFile } from "node:child_process"

import { parsePosixProcessTable, parseWindowsProcessTable, type ProcessInfo } from "./process-table"

export interface ProcessKiller {
  readonly isAlive: (pid: number) => boolean | Promise<boolean>
  readonly kill: (pid: number) => Promise<void>
  readonly terminate: (pid: number) => Promise<void>
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

function enumeratePosixProcesses(): Promise<ProcessInfo[]> {
  return execFileText("ps", ["-eo", "pid=,ppid=,command="]).then(parsePosixProcessTable)
}

function enumerateWindowsProcesses(): Promise<ProcessInfo[]> {
  const command = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,ParentProcessId,CommandLine",
    "ConvertTo-Json -Compress -Depth 2",
  ].join(" | ")
  return execFileText("powershell.exe", ["-NoProfile", "-Command", command]).then(parseWindowsProcessTable)
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
  return {
    isAlive: defaultIsProcessAlive,
    kill: (pid) => execFileVoid("taskkill.exe", ["/PID", String(pid), "/T", "/F"]),
    terminate: (pid) => execFileVoid("taskkill.exe", ["/PID", String(pid), "/T"]),
  }
}

function execFileText(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, [...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
      if (error !== null) {
        reject(error)
        return
      }
      resolvePromise(stdout)
    })
  })
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
