import { afterEach, describe, expect, it } from "bun:test"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  getPluginSandboxDir,
  getPluginSandboxRoot,
  isPluginSandboxDir,
  removePluginSandbox,
  toPluginSandboxSpec,
} from "./opencode-plugin-sandbox"

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-plugin-sandbox-"))
  tempDirs.push(dir)
  return dir
}

function seedSandbox(cacheDir: string, spec: string): string {
  const dir = join(getPluginSandboxRoot(cacheDir), spec)
  mkdirSync(join(dir, "node_modules", "oh-my-openagent"), { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ dependencies: {} }))
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("toPluginSandboxSpec", () => {
  it("#given a bare package name #when resolving the spec #then it expands to the @latest tag OpenCode installs", () => {
    // given / when / then
    expect(toPluginSandboxSpec("oh-my-openagent")).toBe("oh-my-openagent@latest")
    expect(toPluginSandboxSpec("oh-my-opencode")).toBe("oh-my-opencode@latest")
  })

  it("#given a tagged or pinned entry #when resolving the spec #then it is used verbatim", () => {
    // given / when / then
    expect(toPluginSandboxSpec("oh-my-openagent@beta")).toBe("oh-my-openagent@beta")
    expect(toPluginSandboxSpec("oh-my-openagent@5.0.0-beta.89")).toBe("oh-my-openagent@5.0.0-beta.89")
  })

  it("#given a foreign or file entry #when resolving the spec #then there is no sandbox to touch", () => {
    // given / when / then
    expect(toPluginSandboxSpec("some-other-plugin@latest")).toBeNull()
    expect(toPluginSandboxSpec("file:///repo/dist/index.js")).toBeNull()
    expect(toPluginSandboxSpec("oh-my-openagent-extras")).toBeNull()
  })
})

describe("isPluginSandboxDir", () => {
  it("#given a directory under the cache packages root #when guarding #then only our own specs qualify", () => {
    // given
    const cacheDir = tempDir()
    const root = getPluginSandboxRoot(cacheDir)

    // when / then
    expect(isPluginSandboxDir(join(root, "oh-my-openagent@beta"), cacheDir)).toBe(true)
    expect(isPluginSandboxDir(join(root, "oh-my-opencode@latest"), cacheDir)).toBe(true)
    expect(isPluginSandboxDir(join(root, "some-other-plugin@latest"), cacheDir)).toBe(false)
  })

  it("#given a plugin loaded from outside the cache #when guarding #then it is refused", () => {
    // given — the walk-up from import.meta.url resolves here when a user
    // installed the package into a project or a global prefix; deleting it
    // would destroy a directory we do not own.
    const cacheDir = tempDir()
    const projectWorkspace = join(tempDir(), "my-project")

    // when / then
    expect(isPluginSandboxDir(projectWorkspace, cacheDir)).toBe(false)
    expect(isPluginSandboxDir(join(projectWorkspace, "oh-my-openagent@latest"), cacheDir)).toBe(false)
    expect(isPluginSandboxDir(getPluginSandboxRoot(cacheDir), cacheDir)).toBe(false)
    expect(isPluginSandboxDir(cacheDir, cacheDir)).toBe(false)
  })

  it("#given a symlinked cache path #when guarding #then the canonical paths still match", () => {
    // given — $TMPDIR on macOS is a symlink, so the raw strings differ
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@beta")

    // when / then
    expect(isPluginSandboxDir(sandboxDir, cacheDir)).toBe(true)
  })
})

describe("removePluginSandbox", () => {
  it("#given a sandbox for our package #when removing #then the whole spec directory is gone", () => {
    // given
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@beta")
    const other = seedSandbox(cacheDir, "oh-my-openagent@latest")

    // when
    const removed = removePluginSandbox(sandboxDir, cacheDir)

    // then
    expect(removed).toBe(true)
    expect(existsSync(sandboxDir)).toBe(false)
    expect(existsSync(other)).toBe(true)
  })

  it("#given a directory outside the sandbox root #when removing #then nothing is deleted", () => {
    // given
    const cacheDir = tempDir()
    const foreign = join(tempDir(), "oh-my-openagent@latest")
    mkdirSync(foreign, { recursive: true })

    // when
    const removed = removePluginSandbox(foreign, cacheDir)

    // then
    expect(removed).toBe(false)
    expect(existsSync(foreign)).toBe(true)
  })

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "#given the sandbox cannot be detached from the packages dir #when removing #then it throws and the installed package is left whole",
    () => {
      // given - a read-only packages dir stands in for a Windows file lock or
      // EACCES: entries inside the sandbox are deletable, the sandbox itself is not
      const cacheDir = tempDir()
      const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@latest")
      const installedManifest = join(sandboxDir, "node_modules", "oh-my-openagent", "package.json")
      writeFileSync(installedManifest, JSON.stringify({ name: "oh-my-openagent", version: "4.19.4" }))
      const packagesDir = getPluginSandboxRoot(cacheDir)
      chmodSync(packagesDir, 0o555)

      try {
        // when / then - OpenCode's Npm.add() would load a half-deleted copy, so
        // a failed removal must not have deleted anything
        expect(() => removePluginSandbox(sandboxDir, cacheDir)).toThrow()
        expect(existsSync(installedManifest)).toBe(true)
        expect(readdirSync(packagesDir)).toEqual(["oh-my-openagent@latest"])
      } finally {
        chmodSync(packagesDir, 0o755)
      }
    },
  )

  it("#given a successful removal #when listing the packages dir #then no discarded copy is left behind", () => {
    // given
    const cacheDir = tempDir()
    const sandboxDir = seedSandbox(cacheDir, "oh-my-openagent@latest")
    const sibling = seedSandbox(cacheDir, "some-other-plugin@latest")

    // when
    removePluginSandbox(sandboxDir, cacheDir)

    // then
    expect(readdirSync(getPluginSandboxRoot(cacheDir))).toEqual(["some-other-plugin@latest"])
    expect(existsSync(sibling)).toBe(true)
  })

  it("#given a sandbox that is already gone #when removing #then it reports nothing removed", () => {
    // given
    const cacheDir = tempDir()

    // when
    const removed = removePluginSandbox(join(getPluginSandboxRoot(cacheDir), "oh-my-openagent@latest"), cacheDir)

    // then
    expect(removed).toBe(false)
  })
})

describe("getPluginSandboxDir", () => {
  it("#given a config entry #when resolving its sandbox #then it points at <cache>/packages/<spec>", () => {
    // given
    const cacheDir = "/cache"

    // when / then
    expect(getPluginSandboxDir(cacheDir, "oh-my-openagent")).toBe(join("/cache", "packages", "oh-my-openagent@latest"))
    expect(getPluginSandboxDir(cacheDir, "oh-my-openagent@beta")).toBe(join("/cache", "packages", "oh-my-openagent@beta"))
    expect(getPluginSandboxDir(cacheDir, "third-party")).toBeNull()
  })
})
