import { execFile } from "node:child_process"

import { parsePosixProcessTable, parseWindowsProcessTable, type CodegraphProcessInfo } from "./process-match"

export interface CodegraphProcessKiller {
  readonly isAlive: (pid: number) => boolean | Promise<boolean>
  readonly kill: (pid: number) => Promise<void>
  readonly terminate: (pid: number) => Promise<void>
}

export function enumerateCodegraphProcesses(platform: NodeJS.Platform = process.platform): Promise<CodegraphProcessInfo[]> {
  return platform === "win32" ? enumerateWindowsProcesses() : enumeratePosixProcesses()
}

export function createDefaultCodegraphProcessKiller(platform: NodeJS.Platform = process.platform): CodegraphProcessKiller {
  return platform === "win32" ? createWindowsKiller() : createPosixKiller()
}

function enumeratePosixProcesses(): Promise<CodegraphProcessInfo[]> {
  return execFileText("ps", ["-eo", "pid=,ppid=,command="]).then(parsePosixProcessTable)
}

function enumerateWindowsProcesses(): Promise<CodegraphProcessInfo[]> {
  const command = [
    "Get-CimInstance Win32_Process",
    "Select-Object ProcessId,ParentProcessId,CommandLine",
    "ConvertTo-Json -Compress -Depth 2",
  ].join(" | ")
  return execFileText("powershell.exe", ["-NoProfile", "-Command", command]).then(parseWindowsProcessTable)
}

function createPosixKiller(): CodegraphProcessKiller {
  return {
    isAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        if (!(error instanceof Error)) throw error
        return processKillErrorMeansAlive(error)
      }
    },
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

function createWindowsKiller(): CodegraphProcessKiller {
  return {
    isAlive: (pid) => {
      try {
        process.kill(pid, 0)
        return true
      } catch (error) {
        if (!(error instanceof Error)) throw error
        return processKillErrorMeansAlive(error)
      }
    },
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
