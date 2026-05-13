import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// Hold mutable mock state so beforeEach can swap the cache root for each test.
const mockState: { candidates: string[]; walkUpResult: string | null } = {
  candidates: [],
  walkUpResult: null,
}

mock.module("../constants", () => ({
  INSTALLED_PACKAGE_JSON_CANDIDATES: new Proxy([], {
    get(_, prop) {
      const current = mockState.candidates
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
  findPackageJsonUp: () => mockState.walkUpResult,
}))

import { getCachedVersion } from "./cached-version"

describe("getCachedVersion (GH-3257)", () => {
  let cacheRoot: string

  beforeEach(() => {
    cacheRoot = mkdtempSync(join(tmpdir(), "omo-cached-version-"))
    mockState.candidates = [
      join(cacheRoot, "node_modules", "oh-my-opencode", "package.json"),
      join(cacheRoot, "node_modules", "oh-my-openagent", "package.json"),
    ]
    mockState.walkUpResult = null
  })

  afterEach(() => {
    rmSync(cacheRoot, { recursive: true, force: true })
    mockState.candidates = []
    mockState.walkUpResult = null
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

  it("prefers the loaded module's package.json over flat-install candidates", () => {
    // OpenCode loads plugins from a per-plugin sandbox at
    // <CACHE_DIR>/<plugin-entry>/node_modules/<pkg>/, while a parallel flat
    // install at <CACHE_DIR>/node_modules/<pkg>/ can drift independently when
    // bun re-resolves "latest". The flat install must NOT take precedence,
    // because that's the path the user is actually running.
    const sandboxDir = join(cacheRoot, "oh-my-openagent@latest", "node_modules", "oh-my-openagent")
    mkdirSync(sandboxDir, { recursive: true })
    const sandboxPkgJson = join(sandboxDir, "package.json")
    writeFileSync(sandboxPkgJson, JSON.stringify({ name: "oh-my-openagent", version: "3.17.5" }))
    mockState.walkUpResult = sandboxPkgJson

    const flatDir = join(cacheRoot, "node_modules", "oh-my-opencode")
    mkdirSync(flatDir, { recursive: true })
    writeFileSync(join(flatDir, "package.json"), JSON.stringify({ name: "oh-my-opencode", version: "3.17.6" }))

    expect(getCachedVersion()).toBe("3.17.5")
  })
})
