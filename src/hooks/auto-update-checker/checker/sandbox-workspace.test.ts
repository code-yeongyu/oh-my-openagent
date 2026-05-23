import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getLoadedSandboxWorkspace } from "./sandbox-workspace"

describe("getLoadedSandboxWorkspace (issue #4318)", () => {
  let cacheRoot: string

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), "omo-sandbox-workspace-"))
  })

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true })
  })

  it("returns the sandbox directory when the loaded module lives under the cache", () => {
    const sandboxDir = join(cacheRoot, "oh-my-openagent@latest")
    const pkgDir = join(sandboxDir, "node_modules", "oh-my-openagent")
    mkdirSync(pkgDir, { recursive: true })
    const pkgJson = join(pkgDir, "package.json")
    writeFileSync(pkgJson, JSON.stringify({ name: "oh-my-openagent", version: "3.17.5" }))

    expect(
      getLoadedSandboxWorkspace({
        currentDir: pkgDir,
        findPackageJson: () => pkgJson,
        cacheDir: cacheRoot,
        existsSync,
      })
    ).toBe(sandboxDir)
  })

  it("returns null when the loaded module is outside the cache root (local dev)", () => {
    const devDir = mkdtempSync(join(tmpdir(), "omo-localdev-"))
    try {
      const pkgDir = join(devDir, "node_modules", "oh-my-openagent")
      mkdirSync(pkgDir, { recursive: true })
      const pkgJson = join(pkgDir, "package.json")
      writeFileSync(pkgJson, JSON.stringify({ name: "oh-my-openagent", version: "3.17.5" }))

      expect(
        getLoadedSandboxWorkspace({
          currentDir: pkgDir,
          findPackageJson: () => pkgJson,
          cacheDir: cacheRoot,
          existsSync,
        })
      ).toBeNull()
    } finally {
      rmSync(devDir, { recursive: true, force: true })
    }
  })

  it("returns null when walk-up cannot locate a package.json", () => {
    expect(
      getLoadedSandboxWorkspace({
        currentDir: cacheRoot,
        findPackageJson: () => null,
        cacheDir: cacheRoot,
        existsSync,
      })
    ).toBeNull()
  })

  it("returns null when the loaded package.json is not inside a node_modules directory", () => {
    // Sandbox shape that does not match `<workspace>/node_modules/<pkg>/`.
    const oddDir = join(cacheRoot, "oh-my-openagent@latest", "weird")
    mkdirSync(oddDir, { recursive: true })
    const pkgJson = join(oddDir, "package.json")
    writeFileSync(pkgJson, JSON.stringify({ name: "oh-my-openagent", version: "3.17.5" }))

    expect(
      getLoadedSandboxWorkspace({
        currentDir: oddDir,
        findPackageJson: () => pkgJson,
        cacheDir: cacheRoot,
        existsSync,
      })
    ).toBeNull()
  })

  it("returns null when the resolved workspace no longer exists on disk", () => {
    const sandboxDir = join(cacheRoot, "ghost@latest")
    const pkgJson = join(sandboxDir, "node_modules", "oh-my-openagent", "package.json")

    expect(
      getLoadedSandboxWorkspace({
        currentDir: cacheRoot,
        findPackageJson: () => pkgJson,
        cacheDir: cacheRoot,
        existsSync,
      })
    ).toBeNull()
  })
})
