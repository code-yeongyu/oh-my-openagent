/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { prepareGitBashForInstall, resolveGitBash } from "./git-bash"

const PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe"
const PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe"

describe("git-bash", () => {
  test("#given non-Windows platform #when resolving Git Bash #then no preflight is required", () => {
    // given / when
    const result = resolveGitBash({
      platform: "darwin",
      env: {},
      exists: () => false,
      where: () => [],
    })

    // then
    expect(result).toEqual({ found: true, path: null, source: "not-required" })
  })

  test("#given Windows env override to bash.exe #when the file exists #then env path wins", () => {
    // given
    const overridePath = "D:\\Tools\\Git\\bin\\bash.exe"

    // when
    const result = resolveGitBash({
      platform: "win32",
      env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
      exists: (path: string) => path === overridePath,
      where: () => [PROGRAM_FILES_GIT_BASH],
    })

    // then
    expect(result).toEqual({ found: true, path: overridePath, source: "env" })
  })

  test("#given Windows env override not pointing to bash.exe #when resolving #then reports invalid override and stops", () => {
    // given
    const overridePath = "D:\\Tools\\Git\\bin\\git.exe"

    // when
    const result = resolveGitBash({
      platform: "win32",
      env: { OMO_CODEX_GIT_BASH_PATH: overridePath },
      exists: () => true,
      where: () => [PROGRAM_FILES_GIT_BASH],
    })

    // then
    expect(result.found).toBe(false)
    if (result.found) return
    expect(result.checkedPaths).toContain(overridePath)
    expect(result.installHint).toContain("OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash.exe")
  })

  test("#given Windows standard 64-bit Git Bash exists #when resolving #then uses Program Files path", () => {
    // given / when
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path: string) => path === PROGRAM_FILES_GIT_BASH,
      where: () => [],
    })

    // then
    expect(result).toEqual({ found: true, path: PROGRAM_FILES_GIT_BASH, source: "program-files" })
  })

  test("#given Windows standard 32-bit Git Bash exists #when resolving #then uses Program Files x86 path", () => {
    // given / when
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path: string) => path === PROGRAM_FILES_X86_GIT_BASH,
      where: () => [],
    })

    // then
    expect(result).toEqual({ found: true, path: PROGRAM_FILES_X86_GIT_BASH, source: "program-files-x86" })
  })

  test("#given Windows bash on PATH #when standard paths are missing #then uses where bash candidate", () => {
    // given
    const launcherPath = "C:\\Windows\\System32\\bash.exe"
    const pathCandidate = "E:\\Git\\bin\\bash.exe"

    // when
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path: string) => path === launcherPath || path === pathCandidate,
      where: () => [launcherPath, pathCandidate],
    })

    // then
    expect(result).toEqual({ found: true, path: pathCandidate, source: "path" })
  })

  test("#given Windows System32 bash alias is the only PATH candidate #when resolving #then it is not accepted as Git Bash", () => {
    // given
    const system32Bash = "C:\\Windows\\System32\\bash.exe"

    // when
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path: string) => path === system32Bash,
      where: () => [system32Bash],
    })

    // then
    expect(result.found).toBe(false)
    if (result.found) return
    expect(result.checkedPaths).toEqual([PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH, system32Bash])
  })

  test("#given WindowsApps bash alias is the only PATH candidate #when resolving #then it is not accepted as Git Bash", () => {
    // given
    const windowsAppsBash = "C:\\Users\\codex\\AppData\\Local\\Microsoft\\WindowsApps\\bash.exe"

    // when
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: (path: string) => path === windowsAppsBash,
      where: () => [windowsAppsBash],
    })

    // then
    expect(result.found).toBe(false)
    if (result.found) return
    expect(result.checkedPaths).toEqual([PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH, windowsAppsBash])
  })

  test("#given Windows without Git Bash #when resolving #then returns install guidance", () => {
    // given / when
    const result = resolveGitBash({
      platform: "win32",
      env: {},
      exists: () => false,
      where: () => [],
    })

    // then
    expect(result.found).toBe(false)
    if (result.found) return
    expect(result.checkedPaths).toEqual([PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH])
    expect(result.installHint).toContain("winget install --id Git.Git -e --source winget")
    expect(result.installHint).toContain("OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash.exe")
    expect(result.installHint).toContain("rerun `npx lazycodex-ai install`")
    expect(result.installHint).not.toContain("bunx")
  })

  test("#given Windows without Git Bash and winget is allowed #when preparing #then winget runs and resolver is retried", async () => {
    // given
    const runCalls: string[] = []
    const resolutions = [
      { found: false, checkedPaths: [PROGRAM_FILES_GIT_BASH], installHint: "install hint" } as const,
      { found: true, path: PROGRAM_FILES_GIT_BASH, source: "program-files" } as const,
    ]
    let resolveCallCount = 0

    // when
    const result = await prepareGitBashForInstall({
      platform: "win32",
      env: {},
      cwd: "C:\\repo",
      resolveGitBash: () => resolutions[resolveCallCount++] ?? resolutions[resolutions.length - 1],
      runCommand: async (command, args, options) => {
        runCalls.push([command, ...args, options.cwd].join(" "))
      },
    })

    // then
    expect(runCalls).toEqual(["winget install --id Git.Git -e --source winget C:\\repo"])
    expect(resolveCallCount).toBe(2)
    expect(result).toEqual({ found: true, path: PROGRAM_FILES_GIT_BASH, source: "program-files" })
  })

  test("#given Windows without Git Bash and skip env is set #when preparing #then winget is not run and install hint is returned", async () => {
    // given
    const runCalls: string[] = []
    const missingResolution = {
      found: false,
      checkedPaths: [PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH],
      installHint: "install hint",
    } as const

    // when
    const result = await prepareGitBashForInstall({
      platform: "win32",
      env: { OMO_CODEX_SKIP_GIT_BASH_AUTO_INSTALL: "1" },
      cwd: "C:\\repo",
      resolveGitBash: () => missingResolution,
      runCommand: async (command, args, options) => {
        runCalls.push([command, ...args, options.cwd].join(" "))
      },
    })

    // then
    expect(runCalls).toEqual([])
    expect(result).toEqual(missingResolution)
  })

  test("#given non-Windows platform #when preparing #then winget is never called", async () => {
    // given
    const runCalls: string[] = []

    // when
    const result = await prepareGitBashForInstall({
      platform: "linux",
      env: {},
      cwd: "/repo",
      runCommand: async (command, args, options) => {
        runCalls.push([command, ...args, options.cwd].join(" "))
      },
    })

    // then
    expect(runCalls).toEqual([])
    expect(result).toEqual({ found: true, path: null, source: "not-required" })
  })

  test("#given Windows without Git Bash and winget fails #when preparing #then original install hint is preserved", async () => {
    // given
    const missingResolution = {
      found: false,
      checkedPaths: [PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH],
      installHint: "install hint",
    } as const

    // when
    const result = await prepareGitBashForInstall({
      platform: "win32",
      env: {},
      cwd: "C:\\repo",
      resolveGitBash: () => missingResolution,
      runCommand: async () => {
        throw new Error("winget unavailable")
      },
    })

    // then
    expect(result).toEqual(missingResolution)
  })

  test("#given Windows without Git Bash and winget exits successfully but bash is still missing #when preparing #then installer still fails with install hint", async () => {
    // given
    const missingResolution = {
      found: false,
      checkedPaths: [PROGRAM_FILES_GIT_BASH, PROGRAM_FILES_X86_GIT_BASH],
      installHint: "install hint",
    } as const
    let resolveCallCount = 0

    // when
    const result = await prepareGitBashForInstall({
      platform: "win32",
      env: {},
      cwd: "C:\\repo",
      resolveGitBash: () => {
        resolveCallCount += 1
        return missingResolution
      },
      runCommand: async () => undefined,
    })

    // then
    expect(resolveCallCount).toBe(2)
    expect(result).toEqual(missingResolution)
  })
})
