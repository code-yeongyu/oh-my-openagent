/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { win32 } from "node:path"
import { detectCodexInstallation, formatCodexInstallationWarning } from "./codex-installation-detection"

describe("detectCodexInstallation", () => {
  test("#given Codex CLI on PATH #when detecting installation #then returns the CLI path", async () => {
    // given
    const cliPath = "/opt/homebrew/bin/codex"

    // when
    const result = await detectCodexInstallation({
      platform: "darwin",
      homeDir: "/Users/example",
      which: () => cliPath,
      exists: () => false,
    })

    // then
    expect(result).toEqual({ found: true, source: "cli", path: cliPath })
  })

  test("#given macOS Codex app bundle #when detecting installation #then returns the app path", async () => {
    // given
    const appPath = "/Users/example/Applications/Codex.app"

    // when
    const result = await detectCodexInstallation({
      platform: "darwin",
      homeDir: "/Users/example",
      which: () => null,
      exists: (path) => path === appPath,
    })

    // then
    expect(result).toEqual({ found: true, source: "mac-app", path: appPath })
  })

  test("#given only a downloaded macOS Codex dmg #when detecting installation #then returns a missing result with the dmg hint", async () => {
    // given
    const dmgPath = "/Users/example/Downloads/codex.dmg"

    // when
    const result = await detectCodexInstallation({
      platform: "darwin",
      homeDir: "/Users/example",
      which: () => null,
      exists: (path) => path === dmgPath,
    })

    // then
    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.downloadedInstallerPath).toBe(dmgPath)
      expect(result.hint).toContain(dmgPath)
      expect(formatCodexInstallationWarning(result)).toContain("Codex CLI or desktop app was not detected")
    }
  })

  test("#given Windows standard Codex CLI install location #when detecting installation #then returns the standard CLI path", async () => {
    // given
    const localAppData = "C:\\Users\\example\\AppData\\Local"
    const cliPath = win32.join(localAppData, "Programs", "OpenAI", "Codex", "bin", "codex.exe")

    // when
    const result = await detectCodexInstallation({
      platform: "win32",
      env: { LOCALAPPDATA: localAppData },
      homeDir: "C:\\Users\\example",
      which: () => null,
      exists: (path) => path === cliPath,
      runCommand: async () => ({ success: false, stdout: "" }),
    })

    // then
    expect(result).toEqual({ found: true, source: "windows-standard-cli", path: cliPath })
  })

  test("#given Windows Codex Start Apps entry #when detecting installation #then returns the desktop app source", async () => {
    // given
    const appId = "OpenAI.Codex_8wekyb3d8bbwe!App"

    // when
    const result = await detectCodexInstallation({
      platform: "win32",
      env: {},
      homeDir: "C:\\Users\\example",
      which: () => null,
      exists: () => false,
      runCommand: async () => ({ success: true, stdout: `${appId}\r\n` }),
    })

    // then
    expect(result).toEqual({ found: true, source: "windows-start-app", appId })
  })

  test("#given Linux without Codex CLI #when detecting installation #then returns a missing result with an install hint", async () => {
    // given
    const checkedPath = "codex (PATH)"

    // when
    const result = await detectCodexInstallation({
      platform: "linux",
      homeDir: "/home/example",
      which: () => null,
      exists: () => false,
    })

    // then
    expect(result.found).toBe(false)
    if (!result.found) {
      expect(result.checkedPaths).toContain(checkedPath)
      expect(result.hint).toContain("Install OpenAI Codex CLI")
    }
  })
})
