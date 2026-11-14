import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { afterEach } from "node:test"

import { installMarketplaceLocally } from "./install-local.mjs"
import { createCodexInstallSandbox, disposeCodexInstallSandboxes } from "./install-test-fixtures.mjs"

afterEach(disposeCodexInstallSandboxes)

const windowsGitBashPath = "C:\\Program Files\\Git\\bin\\bash.exe"
const lspCliPath = join(process.cwd(), "packages", "lsp-tools-mcp", "dist", "cli.js")

async function withBundledLspRuntimeForTest(run) {
  try {
    await stat(lspCliPath)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    await mkdir(join(process.cwd(), "packages", "lsp-tools-mcp", "dist"), { recursive: true })
    await writeFile(lspCliPath, "#!/usr/bin/env node\n")
  }

  return run()
}

test("#given Windows without Git Bash #when installing local marketplace #then rejects before marketplace or config mutation", async () => {
  const sandbox = createCodexInstallSandbox("git-bash-preflight")
  const repoRoot = sandbox.dir("repo")
  const codexHome = sandbox.codexHome
  const commands = []

  await assert.rejects(
    installMarketplaceLocally(
      sandbox.options({
        repoRoot,

        platform: "win32",
        gitBashResolver: () => ({
          found: false,
          checkedPaths: [windowsGitBashPath],
          installHint: [
            "Git Bash is required.",
            "winget install --id Git.Git -e --source winget",
            "OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash.exe",
            "rerun `npx lazycodex-ai install`",
          ].join("\n"),
        }),
        runCommand: async (command, args, options) => {
          commands.push([command, ...args, options.cwd].join(" "))
        },
        log: () => {},
      }),
    ),
    /winget install --id Git\.Git -e --source winget/,
  )
  assert.deepEqual(commands, [])
  await assert.rejects(stat(join(codexHome, "config.toml")), /ENOENT/)
})

test("#given Windows without Git Bash #when installing local marketplace #then winget is not run and install stops with guidance", async () => {
  const runCalls = []
  const missingResolution = {
    found: false,
    checkedPaths: [windowsGitBashPath],
    installHint: [
      "Git Bash is required.",
      "winget install --id Git.Git -e --source winget",
      "OMO_CODEX_GIT_BASH_PATH=C:\\path\\to\\bash.exe",
      "rerun `npx lazycodex-ai install`",
    ].join("\n"),
  }
  let resolveCallCount = 0
  const sandbox = createCodexInstallSandbox("git-bash-preflight")
  const codexHome = sandbox.codexHome

  await assert.rejects(
    withBundledLspRuntimeForTest(async () =>
      installMarketplaceLocally(
        sandbox.options({
          repoRoot: process.cwd(),
          platform: "win32",
          gitBashResolver: () => {
            resolveCallCount += 1
            return missingResolution
          },
          runCommand: async (command, args, options) => {
            runCalls.push([command, ...args, options.cwd].join(" "))
          },
          log: () => {},
        }),
      ),
    ),
    /winget install --id Git\.Git -e --source winget/,
  )

  assert.equal(resolveCallCount, 1)
  assert.deepEqual(runCalls, [])
  await assert.rejects(stat(join(codexHome, "config.toml")), /ENOENT/)
})

test("#given non-Windows install #when running installer #then winget is never called", async () => {
  const sandbox = createCodexInstallSandbox("git-bash-preflight")
  const runCalls = []
  const result = await withBundledLspRuntimeForTest(async () =>
    installMarketplaceLocally(
      sandbox.options({
        repoRoot: process.cwd(),
        platform: "linux",
        runCommand: async (command, args, options) => {
          runCalls.push([command, ...args, options.cwd].join(" "))
        },
        log: () => {},
      }),
    ),
  )

  assert.equal(result.gitBashPath, null)
  assert.equal(
    runCalls.some((command) => command.startsWith("winget ")),
    false,
  )
})

test("#given Windows env override resolves Git Bash #when installing local marketplace #then install continues", async () => {
  const sandbox = createCodexInstallSandbox("git-bash-preflight")
  const result = await withBundledLspRuntimeForTest(async () =>
    installMarketplaceLocally(
      sandbox.options({
        repoRoot: process.cwd(),
        platform: "win32",
        gitBashResolver: () => ({ found: true, path: windowsGitBashPath, source: "env" }),
        runCommand: async () => {},
        log: () => {},
      }),
    ),
  )

  assert.equal(result.gitBashPath, windowsGitBashPath)
  assert.equal(result.installed.length, 1)
})

test("#given Windows env override in installer options #when no custom resolver is provided #then default resolver uses it", async () => {
  const sandbox = createCodexInstallSandbox("git-bash-preflight")
  const codexHome = sandbox.codexHome
  const gitBashPath = join(await mkdtemp(join(tmpdir(), "omo-codex-script-git-bash-env-")), "bash.exe")
  await writeFile(gitBashPath, "")

  const result = await withBundledLspRuntimeForTest(async () =>
    installMarketplaceLocally(
      sandbox.options({
        repoRoot: process.cwd(),
        platform: "win32",
        env: { OMO_CODEX_GIT_BASH_PATH: gitBashPath },
        runCommand: async () => {},
        log: () => {},
      }),
    ),
  )

  assert.equal(result.gitBashPath, gitBashPath)
})

test("#given non-Windows local install #when resolver would fail #then installer keeps existing behavior", async () => {
  const sandbox = createCodexInstallSandbox("git-bash-preflight")
  const codexHome = sandbox.codexHome
  const result = await withBundledLspRuntimeForTest(async () =>
    installMarketplaceLocally(
      sandbox.options({
        repoRoot: process.cwd(),
        platform: "linux",
        gitBashResolver: () => ({
          found: false,
          checkedPaths: [windowsGitBashPath],
          installHint: "should not be used",
        }),
        runCommand: async () => {},
        log: () => {},
      }),
    ),
  )

  assert.equal(result.gitBashPath, null)
  assert.match(await readFile(join(codexHome, "config.toml"), "utf8"), /\[marketplaces\.sisyphuslabs\]/)
})
