import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
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

  it("resolves the sandbox even when the cache root is reached through a symlink/junction (issue #4349 follow-up)", () => {
    // Simulate the Windows junction case: the cache root the constants module
    // resolved (`cacheRoot`) and the cache root the loaded module's path
    // actually walks up to (`linkedCache`) refer to the same directory but
    // via different filesystem paths. realpath() must collapse them so the
    // containment check succeeds.
    const realCache = mkdtempSync(join(tmpdir(), "omo-sandbox-real-"))
    const linkedCache = `${realCache}-link`
    try {
      symlinkSync(realCache, linkedCache, "dir")

      const sandboxDir = join(linkedCache, "oh-my-openagent@latest")
      const pkgDir = join(sandboxDir, "node_modules", "oh-my-openagent")
      mkdirSync(pkgDir, { recursive: true })
      const pkgJson = join(pkgDir, "package.json")
      writeFileSync(pkgJson, JSON.stringify({ name: "oh-my-openagent", version: "3.17.5" }))

      // Pass the link path as cacheDir, the real path as the workspace
      // (mirrors a real install where one side is a junction).
      expect(
        getLoadedSandboxWorkspace({
          currentDir: pkgDir,
          findPackageJson: () => pkgJson,
          cacheDir: linkedCache,
          existsSync,
          realpathSync,
        })
      ).toBe(sandboxDir)
    } finally {
      try {
        rmSync(linkedCache, { recursive: true, force: true })
      } catch {
        // ignore
      }
      rmSync(realCache, { recursive: true, force: true })
    }
  })

  it("uses the provided realpathSync to resolve cache and workspace paths", () => {
    // Regression test for PR #4349 review concern: paths must be resolved
    // through realpath before containment checks, otherwise junctions or
    // symlinks (common on Windows) break the "is workspace inside cache?"
    // check and we silently fall back to the broken legacy flat cache path.
    const realCache = mkdtempSync(join(tmpdir(), "omo-sandbox-real-"))
    try {
      const sandboxDir = join(realCache, "oh-my-openagent@latest")
      const pkgDir = join(sandboxDir, "node_modules", "oh-my-openagent")
      mkdirSync(pkgDir, { recursive: true })
      const pkgJson = join(pkgDir, "package.json")
      writeFileSync(pkgJson, JSON.stringify({ name: "oh-my-openagent", version: "3.17.5" }))

      const realpathCalls: string[] = []
      const result = getLoadedSandboxWorkspace({
        currentDir: pkgDir,
        findPackageJson: () => pkgJson,
        cacheDir: realCache,
        existsSync,
        realpathSync: (p) => {
          realpathCalls.push(p)
          return realpathSync(p)
        },
      })

      expect(result).toBe(sandboxDir)
      // Both the cache root and the candidate workspace are resolved through
      // realpath so junctions/symlinks collapse to a comparable form.
      expect(realpathCalls.length).toBeGreaterThanOrEqual(2)
    } finally {
      rmSync(realCache, { recursive: true, force: true })
    }
  })
})
