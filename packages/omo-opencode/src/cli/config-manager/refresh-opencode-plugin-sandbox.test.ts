import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { acquirePluginSandboxLease } from "../../shared/opencode-plugin-sandbox"
import { refreshOpenCodePluginSandboxes } from "./refresh-opencode-plugin-sandbox"

const tempDirs: string[] = []

function tempRoot(): { configDir: string; cacheDir: string } {
  const root = mkdtempSync(join(tmpdir(), "omo-sandbox-refresh-"))
  tempDirs.push(root)
  const configDir = join(root, "config")
  mkdirSync(configDir, { recursive: true })
  return { configDir, cacheDir: join(root, "cache") }
}

function writeOpenCodeConfig(configDir: string, plugin: unknown[], name = "opencode.json"): void {
  writeFileSync(join(configDir, name), JSON.stringify({ plugin }, null, 2))
}

function seedSandbox(cacheDir: string, spec: string): string {
  const sandboxDir = join(cacheDir, "packages", spec)
  mkdirSync(join(sandboxDir, "node_modules", "oh-my-openagent"), { recursive: true })
  writeFileSync(join(sandboxDir, "package.json"), JSON.stringify({ dependencies: {} }))
  return sandboxDir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("refreshOpenCodePluginSandboxes", () => {
  it("#given a bare plugin entry #when refreshing #then the @latest sandbox OpenCode loads is removed and foreign sandboxes survive", () => {
    // given
    const { configDir, cacheDir } = tempRoot()
    writeOpenCodeConfig(configDir, ["oh-my-openagent"])
    const staleSandbox = seedSandbox(cacheDir, "oh-my-openagent@latest")
    const unrelated = seedSandbox(cacheDir, "some-other-plugin@latest")

    // when
    const result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })

    // then
    expect(existsSync(staleSandbox)).toBe(false)
    expect(existsSync(unrelated)).toBe(true)
    expect(result.removed).toEqual([staleSandbox])
  })

  it("#given a tagged plugin entry #when refreshing #then only the spec the config loads is refreshed", () => {
    // given
    const { configDir, cacheDir } = tempRoot()
    writeOpenCodeConfig(configDir, ["oh-my-openagent@beta"])
    const betaSandbox = seedSandbox(cacheDir, "oh-my-openagent@beta")
    const latestSandbox = seedSandbox(cacheDir, "oh-my-openagent@latest")

    // when
    const result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })

    // then
    expect(existsSync(betaSandbox)).toBe(false)
    expect(existsSync(latestSandbox)).toBe(true)
    expect(result.removed).toEqual([betaSandbox])
  })

  it("#given a legacy oh-my-opencode entry in a jsonc config #when refreshing #then the legacy sandbox is removed", () => {
    // given
    const { configDir, cacheDir } = tempRoot()
    writeFileSync(
      join(configDir, "opencode.jsonc"),
      '{\n  // installed by an older release\n  "plugin": ["oh-my-opencode@latest"]\n}\n',
    )
    const legacySandbox = seedSandbox(cacheDir, "oh-my-opencode@latest")

    // when
    const result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })

    // then
    expect(existsSync(legacySandbox)).toBe(false)
    expect(result.removed).toEqual([legacySandbox])
  })

  it("#given a pinned exact version #when refreshing #then its sandbox is refreshed too, since a reinstall lands on the same version", () => {
    // given
    const { configDir, cacheDir } = tempRoot()
    writeOpenCodeConfig(configDir, ["oh-my-openagent@5.0.0-beta.89"])
    const pinnedSandbox = seedSandbox(cacheDir, "oh-my-openagent@5.0.0-beta.89")

    // when
    const result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })

    // then
    expect(result.removed).toEqual([pinnedSandbox])
  })

  it("#given a file: dev entry #when refreshing #then no sandbox is touched", () => {
    // given
    const { configDir, cacheDir } = tempRoot()
    writeOpenCodeConfig(configDir, ["file:///repo/dist/index.js"])
    const unrelated = seedSandbox(cacheDir, "oh-my-openagent@latest")

    // when
    const result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })

    // then
    expect(result.removed).toEqual([])
    expect(existsSync(unrelated)).toBe(true)
  })

  it("#given no sandbox on disk #when refreshing #then nothing is removed and no error surfaces", () => {
    // given
    const { configDir, cacheDir } = tempRoot()
    writeOpenCodeConfig(configDir, ["oh-my-openagent"])

    // when
    const result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })

    // then
    expect(result.removed).toEqual([])
  })

  it("#given OpenCode is still running from the sandbox #when the installer refreshes #then it defers to OpenCode's exit instead of deleting live files", () => {
    // given - the installer runs from a terminal (or the agent) while OpenCode is open
    const { configDir, cacheDir } = tempRoot()
    writeOpenCodeConfig(configDir, ["oh-my-openagent"])
    const sandbox = seedSandbox(cacheDir, "oh-my-openagent@latest")
    acquirePluginSandboxLease(sandbox, process.ppid)

    // when
    const result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })

    // then
    expect(result.removed).toEqual([])
    expect(result.deferred).toEqual([sandbox])
    expect(existsSync(join(sandbox, "node_modules", "oh-my-openagent"))).toBe(true)
  })

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "#given the sandbox cannot be removed #when the installer refreshes #then the failure is returned for the installer to print",
    () => {
      // given
      const { configDir, cacheDir } = tempRoot()
      writeOpenCodeConfig(configDir, ["oh-my-openagent@beta"])
      const sandbox = seedSandbox(cacheDir, "oh-my-openagent@beta")
      const packagesDir = join(cacheDir, "packages")
      chmodSync(packagesDir, 0o555)

      // when
      let result: ReturnType<typeof refreshOpenCodePluginSandboxes>
      try {
        result = refreshOpenCodePluginSandboxes({ configDir, cacheDir })
      } finally {
        chmodSync(packagesDir, 0o755)
      }

      // then
      expect(result.removed).toEqual([])
      expect(result.failed.map((failure) => failure.dir)).toEqual([sandbox])
      expect(existsSync(join(sandbox, "node_modules", "oh-my-openagent"))).toBe(true)
    },
  )
})
