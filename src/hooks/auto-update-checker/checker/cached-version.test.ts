import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const FIXED_CACHE_LAYOUT_ROOT = join(tmpdir(), "omo-cache-layout-fixed")

// Hold mutable mock state so beforeEach can swap the cache root for each test.
const mockState: { cacheCandidates: string[]; configCandidates: string[] } = {
  cacheCandidates: [],
  configCandidates: [],
}

mock.module("../constants", () => ({
  ACCEPTED_PACKAGE_NAMES: ["oh-my-opencode", "oh-my-openagent"],
  CACHE_DIR: FIXED_CACHE_LAYOUT_ROOT,
  INSTALLED_PACKAGE_JSON_CANDIDATES: new Proxy([], {
    get(_, prop) {
      const current = mockState.cacheCandidates
      // Forward array methods/properties to the mutable candidates list
      // so getCachedVersion's `for (... of ...)` sees fresh data per test.
      const value = (current as unknown as Record<PropertyKey, unknown>)[prop]
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(current)
      }
      return value
    },
  }),
  CONFIG_DIR_PACKAGE_JSON_CANDIDATES: new Proxy([], {
    get(_, prop) {
      const current = mockState.configCandidates
      // Forward array methods/properties to the mutable candidates list
      // so getCachedVersion's `for (... of ...)` sees fresh data per test.
      const value = (current as unknown as Record<PropertyKey, unknown>)[prop]
      if (typeof value === "function") {
        return (value as (...args: unknown[]) => unknown).bind(current)
      }
      return value
    },
  }),
}))

mock.module("./package-json-locator", () => ({
  findPackageJsonUp: () => null,
}))

import { getCachedVersion } from "./cached-version"

describe("getCachedVersion (GH-3257)", () => {
  let cacheRoot: string
  let configRoot: string
  let cachePackagesRoot: string

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), "omo-cached-version-"))
    configRoot = mkdtempSync(join(tmpdir(), "omo-config-version-"))
    cachePackagesRoot = FIXED_CACHE_LAYOUT_ROOT
    rmSync(cachePackagesRoot, { recursive: true, force: true })
    mkdirSync(cachePackagesRoot, { recursive: true })
    mockState.cacheCandidates = [
      join(cacheRoot, "node_modules", "oh-my-opencode", "package.json"),
      join(cacheRoot, "node_modules", "oh-my-openagent", "package.json"),
    ]
    mockState.configCandidates = [
      join(configRoot, "node_modules", "oh-my-opencode", "package.json"),
      join(configRoot, "node_modules", "oh-my-openagent", "package.json"),
    ]
  })

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true })
    rmSync(configRoot, { recursive: true, force: true })
    rmSync(cachePackagesRoot, { recursive: true, force: true })
    mockState.cacheCandidates = []
    mockState.configCandidates = []
  })

  it("returns the version when the package is installed under oh-my-opencode", () => {
    const pkgDir = join(cacheRoot, "node_modules", "oh-my-opencode")
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "3.16.0" }))

    expect(getCachedVersion()).toBe("3.16.0")
  })

  it("returns the version when the package is installed under oh-my-openagent", () => {
    // GH-3257: npm users who install the aliased `oh-my-openagent` package get
    // node_modules/oh-my-openagent/package.json, not the canonical oh-my-opencode
    // path. The cached version resolver must check both.
    const pkgDir = join(cacheRoot, "node_modules", "oh-my-openagent")
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "3.16.0" }))

    expect(getCachedVersion()).toBe("3.16.0")
  })

  it("prefers oh-my-opencode when both are installed", () => {
    const legacyDir = join(cacheRoot, "node_modules", "oh-my-opencode")
    mkdirSync(legacyDir, { recursive: true })
    writeFileSync(join(legacyDir, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "3.16.0" }))

    const aliasDir = join(cacheRoot, "node_modules", "oh-my-openagent")
    mkdirSync(aliasDir, { recursive: true })
    writeFileSync(join(aliasDir, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "3.15.0" }))

    expect(getCachedVersion()).toBe("3.16.0")
  })

  it("returns null when neither candidate exists and fallbacks find nothing", () => {
    expect(getCachedVersion()).toBeNull()
  })

  it("falls back to the user config dir install when cache candidates are missing", () => {
    const pkgDir = join(configRoot, "node_modules", "oh-my-openagent")
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "3.16.1" }))

    expect(getCachedVersion()).toBe("3.16.1")
  })

  it("detects the versioned OpenCode cache layout", () => {
    mockState.cacheCandidates = []
    const pkgDir = join(cachePackagesRoot, "oh-my-openagent@latest", "node_modules", "oh-my-openagent")
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "oh-my-openagent", version: "3.16.2" }))

    expect(getCachedVersion()).toBe("3.16.2")
  })
})
