import { describe, expect, it } from "bun:test"

import { resolveWindowsSystemTool } from "./system-tool-paths"

describe("resolveWindowsSystemTool", () => {
  it("#given a SystemRoot #when resolving taskkill #then System32\\taskkill.exe under that root is returned", () => {
    expect(resolveWindowsSystemTool("taskkill.exe", "C:\\Custom\\Windows")).toBe(
      "C:\\Custom\\Windows\\System32\\taskkill.exe",
    )
  })

  it("#given no SystemRoot #when resolving taskkill #then the C:\\Windows fallback is returned", () => {
    expect(resolveWindowsSystemTool("taskkill.exe", undefined)).toBe("C:\\Windows\\System32\\taskkill.exe")
  })

  it("#given the default argument #when resolving taskkill #then the ambient SystemRoot is used", () => {
    expect(resolveWindowsSystemTool("taskkill.exe")).toBe(
      `${process.env["SystemRoot"] ?? "C:\\Windows"}\\System32\\taskkill.exe`,
    )
  })

  it("#given a SystemRoot #when resolving powershell #then the WindowsPowerShell v1.0 path is returned", () => {
    expect(resolveWindowsSystemTool("WindowsPowerShell\\v1.0\\powershell.exe", "C:\\Custom\\Windows")).toBe(
      "C:\\Custom\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    )
  })

  it("#given no SystemRoot #when resolving powershell #then the C:\\Windows fallback is returned", () => {
    expect(resolveWindowsSystemTool("WindowsPowerShell\\v1.0\\powershell.exe", undefined)).toBe(
      "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    )
  })
})
