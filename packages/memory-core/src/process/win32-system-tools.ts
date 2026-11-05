import { win32 } from "node:path"

import { environmentValue, isDriveQualified } from "./win32-executable"

const SYSTEM32_RELATIVE = {
  "cmd.exe": "cmd.exe",
  "powershell.exe": "WindowsPowerShell\\v1.0\\powershell.exe",
  "reg.exe": "reg.exe",
  "taskkill.exe": "taskkill.exe",
} as const

export type Win32SystemTool = keyof typeof SYSTEM32_RELATIVE

const DEFAULT_WINDOWS_DIRECTORY = "C:\\Windows"

function windowsDirectory(environment: NodeJS.ProcessEnv): string {
  for (const name of ["SystemRoot", "windir"]) {
    const value = environmentValue(environment, name)
    if (value !== undefined && isDriveQualified(value)) return value
  }
  return DEFAULT_WINDOWS_DIRECTORY
}

/** Absolute `%SystemRoot%\System32` path of a Windows tool, so it is never looked up from the cwd (#12146). */
export function win32SystemExecutable(tool: Win32SystemTool, environment: NodeJS.ProcessEnv = process.env): string {
  return win32.join(windowsDirectory(environment), "System32", SYSTEM32_RELATIVE[tool])
}
