import { describe, expect, test } from "bun:test"

import { wrapWindowsShellCommand } from "./windows-shell-command"

describe("wrapWindowsShellCommand", () => {
  test("#given a .cmd command on Windows #when wrapped #then prepends cmd.exe /c", () => {
    // given
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })

    // when
    const result = wrapWindowsShellCommand(["C:\\Program Files\\nodejs\\npm.cmd", "install"])

    // then
    expect(result).toEqual(["cmd.exe", "/c", "C:\\Program Files\\nodejs\\npm.cmd", "install"])

    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  test("#given a .bat command on Windows #when wrapped #then prepends cmd.exe /c", () => {
    // given
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })

    // when
    const result = wrapWindowsShellCommand(["C:\\tools\\jdtls.bat", "--data", "/tmp"])

    // then
    expect(result).toEqual(["cmd.exe", "/c", "C:\\tools\\jdtls.bat", "--data", "/tmp"])

    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  test("#given a .exe command on Windows #when wrapped #then returns unchanged", () => {
    // given
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })

    // when
    const result = wrapWindowsShellCommand(["C:\\Program Files\\nodejs\\node.exe", "dist/cli.js", "mcp"])

    // then
    expect(result).toEqual(["C:\\Program Files\\nodejs\\node.exe", "dist/cli.js", "mcp"])

    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  test("#given any command on non-Windows #when wrapped #then returns unchanged", () => {
    // given
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "linux" })

    // when
    const result = wrapWindowsShellCommand(["/usr/bin/node", "dist/cli.js", "mcp"])

    // then
    expect(result).toEqual(["/usr/bin/node", "dist/cli.js", "mcp"])

    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  test("#given an empty command array #when wrapped #then returns empty array", () => {
    // given
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })

    // when
    const result = wrapWindowsShellCommand([])

    // then
    expect(result).toEqual([])

    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  test("#given a .CMD uppercase extension on Windows #when wrapped #then prepends cmd.exe /c", () => {
    // given
    const originalPlatform = process.platform
    Object.defineProperty(process, "platform", { value: "win32" })

    // when
    const result = wrapWindowsShellCommand(["C:\\tools\\NPM.CMD", "run", "build"])

    // then
    expect(result).toEqual(["cmd.exe", "/c", "C:\\tools\\NPM.CMD", "run", "build"])

    Object.defineProperty(process, "platform", { value: originalPlatform })
  })
})
