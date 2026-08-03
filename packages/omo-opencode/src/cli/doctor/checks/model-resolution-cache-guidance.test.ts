import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkModels } from "./model-resolution"

describe("model cache doctor guidance", () => {
  const originalXdgCacheHome = process.env.XDG_CACHE_HOME
  const originalXdgConfigHome = process.env.XDG_CONFIG_HOME
  let cacheRoot: string | undefined
  let configRoot: string | undefined

  afterEach(() => {
    if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = originalXdgCacheHome
    if (originalXdgConfigHome === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = originalXdgConfigHome
    if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
    if (configRoot) rmSync(configRoot, { recursive: true, force: true })
    cacheRoot = undefined
    configRoot = undefined
  })

  test("reports the exact missing OpenCode cache path and refresh command", async () => {
    // given
    cacheRoot = mkdtempSync(join(tmpdir(), "doctor-model-cache-"))
    process.env.XDG_CACHE_HOME = cacheRoot
    // An opencode.json defining any custom provider makes loadAvailableModelsFromCache report
    // cacheExists even with no models.json, so the config dir has to be isolated too or this
    // test depends on whoever runs it.
    configRoot = mkdtempSync(join(tmpdir(), "doctor-model-config-"))
    process.env.XDG_CONFIG_HOME = configRoot
    const expectedCacheFile = join(cacheRoot, "opencode", "models.json")

    // when
    const result = await checkModels()
    const issue = result.issues.find((candidate) => candidate.title === "Model cache not found")

    // then
    expect(issue?.description).toContain(expectedCacheFile)
    expect(issue?.fix).toContain("opencode models --refresh")
  })
})
