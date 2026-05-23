import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

describe("resolveGrepCli OpenCode cache fallback (#3805)", () => {
  let tempCache: string
  let tempData: string
  let originalCache: string | undefined
  let originalData: string | undefined

  beforeEach(() => {
    const stamp = `omo-ripgrep-cli-${process.pid}-${Date.now()}`
    tempCache = join(tmpdir(), `${stamp}-cache`)
    tempData = join(tmpdir(), `${stamp}-data`)
    mkdirSync(tempCache, { recursive: true })
    mkdirSync(tempData, { recursive: true })
    originalCache = process.env.XDG_CACHE_HOME
    originalData = process.env.XDG_DATA_HOME
    process.env.XDG_CACHE_HOME = tempCache
    process.env.XDG_DATA_HOME = tempData
  })

  afterEach(() => {
    if (originalCache === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = originalCache
    if (originalData === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = originalData
    try {
      rmSync(tempCache, { recursive: true, force: true })
      rmSync(tempData, { recursive: true, force: true })
    } catch {
      // best-effort cleanup
    }
  })

  it("prefers ~/.cache/opencode/bin/rg over ~/.local/share/opencode/bin/rg", async () => {
    const rgName = process.platform === "win32" ? "rg.exe" : "rg"
    const cacheBinDir = join(tempCache, "opencode", "bin")
    const dataBinDir = join(tempData, "opencode", "bin")
    mkdirSync(cacheBinDir, { recursive: true })
    mkdirSync(dataBinDir, { recursive: true })
    const cacheRg = join(cacheBinDir, rgName)
    const dataRg = join(dataBinDir, rgName)
    writeFileSync(cacheRg, "")
    writeFileSync(dataRg, "")

    // Reset the module cache so the singleton cachedCli is fresh.
    delete require.cache[require.resolve("./ripgrep-cli")]
    const { resolveGrepCli } = await import("./ripgrep-cli")

    const resolved = resolveGrepCli()
    expect(resolved.backend).toBe("rg")
    expect(resolved.path).toBe(cacheRg)
  })
})
