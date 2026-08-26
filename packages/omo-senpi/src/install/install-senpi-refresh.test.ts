/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { runSenpiInstaller } from "./install-senpi"

const repoRoot = resolve(import.meta.dir, "../../../..")
const pluginPath = join(repoRoot, "packages", "omo-senpi", "plugin")
const tempDirs: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

async function settingsPackages(agentDir: string): Promise<readonly string[]> {
  const parsed: unknown = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8"))
  if (!isRecord(parsed) || !Array.isArray(parsed.packages)) throw new Error("expected settings packages")
  return parsed.packages.filter((entry): entry is string => typeof entry === "string")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe("runSenpiInstaller source refresh", () => {
  test("#given complete generated artifacts #when installing from source #then every build step still refreshes them", async () => {
    // given
    const agentDir = await tempDir("omo-senpi-source-refresh-")
    const calls: Array<{ readonly command: string; readonly args: readonly string[]; readonly cwd: string }> = []

    // when
    await runSenpiInstaller({
      agentDir,
      repoRoot,
      runCommand: async (command, args, options) => {
        calls.push({ command, args, cwd: options.cwd })
      },
    })

    // then
    expect(calls.map(({ command, args }) => [command, ...args])).toEqual([
      ["node", join(pluginPath, "scripts", "build-extension.mjs")],
      ["node", join("packages", "omo-codex", "plugin", "scripts", "materialize-shared-upstreams.mjs")],
      ["node", join(pluginPath, "scripts", "sync-skills.mjs")],
      ["node", join(pluginPath, "scripts", "build-install.mjs")],
      ["node", join(pluginPath, "scripts", "stage-lsp-daemon-runtime.mjs")],
      ["node", join(pluginPath, "scripts", "stage-ast-grep-mcp-runtime.mjs")],
      ["node", join(pluginPath, "scripts", "stage-agent-toolkit.mjs")],
    ])
    expect(calls.every(({ cwd }) => cwd === repoRoot)).toBe(true)
  })

  test("#given an older local OMO package entry #when installing the current source #then the stale package is replaced", async () => {
    // given
    const agentDir = await tempDir("omo-senpi-package-replace-")
    const stalePlugin = await tempDir("omo-senpi-stale-package-")
    await mkdir(agentDir, { recursive: true })
    await writeFile(join(stalePlugin, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ packages: ["keep-me", stalePlugin] }),
    )

    // when
    await runSenpiInstaller({ agentDir, repoRoot, pluginPath })

    // then
    expect(await settingsPackages(agentDir)).toEqual(["keep-me", pluginPath])
  })

  test("#given current and stale OMO entries #when refreshing #then the current package keeps its precedence", async () => {
    // given
    const agentDir = await tempDir("omo-senpi-package-order-")
    const stalePlugin = await tempDir("omo-senpi-stale-order-")
    await writeFile(join(stalePlugin, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ packages: ["before", pluginPath, stalePlugin, "after"] }),
    )

    // when
    await runSenpiInstaller({ agentDir, repoRoot, pluginPath })

    // then
    expect(await settingsPackages(agentDir)).toEqual(["before", pluginPath, "after"])
  })
})
