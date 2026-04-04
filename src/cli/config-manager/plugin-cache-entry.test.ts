import { afterEach, describe, expect, it } from "bun:test"
import { join } from "node:path"

import {
  getPackageNameFromPluginEntry,
  getOpenCodePackagesCacheRootPath,
  isLocalPluginEntry,
  resolvePluginCacheLocation,
} from "./plugin-cache-entry"

const originalXdgCacheHome = process.env.XDG_CACHE_HOME

afterEach(() => {
  if (originalXdgCacheHome === undefined) {
    delete process.env.XDG_CACHE_HOME
  } else {
    process.env.XDG_CACHE_HOME = originalXdgCacheHome
  }
})

describe("plugin cache entry", () => {
  it("derives the cache path for a bare canonical package entry", () => {
    //#given
    process.env.XDG_CACHE_HOME = "/tmp/omo-cache-entry-bare"

    //#when
    const location = resolvePluginCacheLocation("oh-my-openagent")

    //#then
    expect(location.source).toBe("npm")
    expect(location.packageName).toBe("oh-my-openagent")
    expect(location.cacheDir).toBe(join(getOpenCodePackagesCacheRootPath(), "oh-my-openagent"))
  })

  it("derives the cache path for a tagged canonical package entry", () => {
    //#given
    process.env.XDG_CACHE_HOME = "/tmp/omo-cache-entry-tagged"

    //#when
    const location = resolvePluginCacheLocation("oh-my-openagent@latest")

    //#then
    expect(location.packageName).toBe("oh-my-openagent")
    expect(location.cacheDir).toBe(join(getOpenCodePackagesCacheRootPath(), "oh-my-openagent@latest"))
  })

  it("derives the cache path for an exact version entry", () => {
    //#given
    process.env.XDG_CACHE_HOME = "/tmp/omo-cache-entry-versioned"

    //#when
    const location = resolvePluginCacheLocation("oh-my-openagent@1.2.3")

    //#then
    expect(location.packageName).toBe("oh-my-openagent")
    expect(location.cacheDir).toBe(join(getOpenCodePackagesCacheRootPath(), "oh-my-openagent@1.2.3"))
  })

  it("derives the cache path for a legacy package entry", () => {
    //#given
    process.env.XDG_CACHE_HOME = "/tmp/omo-cache-entry-legacy"

    //#when
    const location = resolvePluginCacheLocation("oh-my-opencode@3.0.0")

    //#then
    expect(location.packageName).toBe("oh-my-opencode")
    expect(location.installedPackageJsonPath).toBe(
      join(getOpenCodePackagesCacheRootPath(), "oh-my-opencode@3.0.0", "node_modules", "oh-my-opencode", "package.json"),
    )
  })

  it("marks file entries as local and skips cache resolution", () => {
    //#given
    const entry = "file:///tmp/oh-my-openagent"

    //#when
    const location = resolvePluginCacheLocation(entry)

    //#then
    expect(isLocalPluginEntry(entry)).toBe(true)
    expect(getPackageNameFromPluginEntry(entry)).toBeNull()
    expect(location.source).toBe("local")
    expect(location.cacheDir).toBeNull()
  })
})
