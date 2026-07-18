import { describe, expect, test } from "bun:test"

import { resolveGitBash } from "./git-bash"

const PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe"
const PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe"

describe("runtime git-bash resolver", () => {
  test("#given non-Windows platform #when resolving Git Bash #then no path is required", () => {
    const result = resolveGitBash({
      platform: "darwin",
      env: {},
      exists: () => false,
      where: () => [],
    })

    expect(result).toEqual({ found: true, path: null, source: "not-required", checkedPaths: [] })
  })

  test("#given Windows env override to existing bash.exe #when resolving #then env path wins before standard paths", () => {
    const overridePath = "D:\\Tools\\Git\\bin\\bash.exe"

    const result = resolveGitBash({
      platform: "win32",
      env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
      exists: (path: string) => path === overridePath || path === PROGRAM_FILES_GIT_BASH,
      where: () => [PROGRAM_FILES_GIT_BASH],
    })

    expect(result).toEqual({ found: true, path: overridePath, source: "env", checkedPaths: [overridePath] })
  })

  test("#given Windows env override to missing path #when resolving #then override failure stops fallback probing", () => {
    const overridePath = "D:\\Missing\\Git\\bin\\bash.exe"

    const result = resolveGitBash({
      platform: "win32",
      env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
      exists: (path: string) => path === PROGRAM_FILES_GIT_BASH,
      where: () => [PROGRAM_FILES_GIT_BASH],
    })

    expect(result.found).toBe(false)
    if (result.found) return
    expect(result.checkedPaths).toEqual([overridePath])
    expect(result.installHint).toContain("winget install --id Git.Git -e --source winget")
    expect(result.installHint).toContain("OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash.exe")
  })

  test("#given blank Windows env override #when resolving #then fallback probing continues", () => {
    const result = resolveGitBash({
      platform: "win32",
      env: { OMO_CODEX_GIT_BASH_PATH: "  " },
      exists: (path: string) => path === PROGRAM_FILES_GIT_BASH,
      where: () => [],
    })

    expect(result).toEqual({
      found: true,
      path: PROGRAM_FILES_GIT_BASH,
      source: "program-files",
      checkedPaths: [PROGRAM_FILES_GIT_BASH],
    })
  })

  test("#given both standard Windows installs exist #when resolving #then Program Files has priority", () => {
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path: string) => path === PROGRAM_FILES_GIT_BASH || path === PROGRAM_FILES_X86_GIT_BASH,
      where: () => [],
    })

    expect(result).toEqual({
      found: true,
      path: PROGRAM_FILES_GIT_BASH,
      source: "program-files",
      checkedPaths: [PROGRAM_FILES_GIT_BASH],
    })
  })

  test("#given PATH lists Windows launchers before real Git Bash #when resolving #then launchers are skipped", () => {
    const system32Bash = "C:\\Windows\\System32\\bash.exe"
    const windowsAppsBash = "C:/Users/dev/AppData/Local/Microsoft/WindowsApps/bash.exe"
    const gitBash = "E:\\Git\\bin\\bash.exe"

    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path: string) => path === system32Bash || path === windowsAppsBash || path === gitBash,
      where: () => [system32Bash, windowsAppsBash, gitBash],
    })

    expect(result).toEqual({
      found: true,
      path: gitBash,
      source: "path",
      checkedPaths: [PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH, system32Bash, windowsAppsBash, gitBash],
    })
  })
})
