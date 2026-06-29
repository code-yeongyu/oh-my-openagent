/// <reference path="../../../../bun-test.d.ts" />
/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { stampGitBashMcpEnv } from "./codex-git-bash-mcp-env"
import { prepareGitBashForInstall, resolveGitBash } from "./git-bash"

const PROGRAM_FILES_GIT_BASH = "C:\\Program Files\\Git\\bin\\bash.exe"
const PROGRAM_FILES_X86_GIT_BASH = "C:\\Program Files (x86)\\Git\\bin\\bash.exe"

describe("git-bash", () => {
  test("#given same-worktree Windows plugin caches #when stamping Git Bash MCP env #then manifests keep distinct cache roots", async () => {
    // given
    const worktreeRoot = await mkdtemp(join(tmpdir(), "omo-codex-git-bash-same-worktree-"))
    const firstPluginRoot = join(worktreeRoot, "codex-a", "plugins", "cache", "sisyphuslabs", "omo", "4.13.0")
    const secondPluginRoot = join(worktreeRoot, "codex-b", "plugins", "cache", "sisyphuslabs", "omo", "4.13.0")
    await writeGitBashMcpManifest(firstPluginRoot)
    await writeGitBashMcpManifest(secondPluginRoot)
    const env = { OMO_CODEX_GIT_BASH_PATH: PROGRAM_FILES_GIT_BASH }

    // when
    const firstChanged = await stampGitBashMcpEnv({ pluginRoot: firstPluginRoot, platform: "win32", env })
    const secondChanged = await stampGitBashMcpEnv({ pluginRoot: secondPluginRoot, platform: "win32", env })

    // then
    expect(firstChanged).toBe(true)
    expect(secondChanged).toBe(true)
    const first = await readMcpManifest(firstPluginRoot)
    const second = await readMcpManifest(secondPluginRoot)
    expect(first.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_PATH).toBe(PROGRAM_FILES_GIT_BASH)
    expect(second.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_PATH).toBe(PROGRAM_FILES_GIT_BASH)
    expect(first.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_MCP_TRANSPORT_ID).toMatch(/^git-bash-[a-f0-9]{16}$/)
    expect(second.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_MCP_TRANSPORT_ID).toMatch(/^git-bash-[a-f0-9]{16}$/)
    expect(first.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_MCP_TRANSPORT_ID).not.toBe(
      second.mcpServers.git_bash.env.OMO_CODEX_GIT_BASH_MCP_TRANSPORT_ID,
    )
    expect(first.mcpServers.codegraph.args[0]).toBe(join(firstPluginRoot, "components", "codegraph", "dist", "serve.js"))
    expect(second.mcpServers.codegraph.args[0]).toBe(join(secondPluginRoot, "components", "codegraph", "dist", "serve.js"))
    expect(first.mcpServers.codegraph.args[0]).not.toBe(second.mcpServers.codegraph.args[0])
  })

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

  test("#given Windows without Git Bash #when preparing Codex install #then winget is not run automatically", async () => {
    // given
    const missingResolution = { found: false, checkedPaths: [PROGRAM_FILES_GIT_BASH], installHint: "install hint" } as const
    let resolveCallCount = 0

    // when
    const result = await prepareGitBashForInstall({
      platform: "win32",
      env: {},
      resolveGitBash: () => {
        resolveCallCount += 1
        return missingResolution
      },
    })

    // then
    expect(resolveCallCount).toBe(1)
    expect(result).toEqual(missingResolution)
  })

  test("#given Windows without Git Bash #when preparing #then winget is not run and install hint is returned", async () => {
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
      resolveGitBash: () => missingResolution,
    })

    // then
    expect(result).toEqual(missingResolution)
  })

  test("#given non-Windows platform #when preparing #then winget is never called", async () => {
    // given
    // when
    const result = await prepareGitBashForInstall({
      platform: "linux",
      env: {},
    })

    // then
    expect(result).toEqual({ found: true, path: null, source: "not-required" })
  })

  test("#given Windows without Git Bash #when preparing #then original install hint is preserved", async () => {
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
      resolveGitBash: () => missingResolution,
    })

    // then
    expect(result).toEqual(missingResolution)
  })

  test("#given Windows without Git Bash #when preparing #then resolver is not retried after system install", async () => {
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
      resolveGitBash: () => {
        resolveCallCount += 1
        return missingResolution
      },
    })

    // then
    expect(resolveCallCount).toBe(1)
    expect(result).toEqual(missingResolution)
  })
})

async function writeGitBashMcpManifest(pluginRoot: string): Promise<void> {
  await mkdir(pluginRoot, { recursive: true })
  await writeFile(
    join(pluginRoot, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        codegraph: { args: ["./components/codegraph/dist/serve.js"] },
        git_bash: { command: "node", args: ["./components/git-bash-mcp/dist/cli.js", "mcp"] },
      },
    }),
  )
}

async function readMcpManifest(pluginRoot: string): Promise<{
  readonly mcpServers: {
    readonly codegraph: { readonly args: readonly string[] }
    readonly git_bash: {
      readonly env: {
        readonly OMO_CODEX_GIT_BASH_PATH: string
        readonly OMO_CODEX_GIT_BASH_MCP_TRANSPORT_ID: string
      }
    }
  }
}> {
  return JSON.parse(await readFile(join(pluginRoot, ".mcp.json"), "utf8"))
}
