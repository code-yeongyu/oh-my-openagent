import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkModels } from "./model-resolution"

describe("model cache doctor guidance", () => {
  const originalXdgCacheHome = process.env.XDG_CACHE_HOME
  let cacheRoot: string | undefined

  afterEach(() => {
    if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME
    else process.env.XDG_CACHE_HOME = originalXdgCacheHome
    if (cacheRoot) rmSync(cacheRoot, { recursive: true, force: true })
    cacheRoot = undefined
  })

  test("reports the exact missing OpenCode cache path and refresh command", async () => {
    // given
    cacheRoot = mkdtempSync(join(tmpdir(), "doctor-model-cache-"))
    process.env.XDG_CACHE_HOME = cacheRoot
    const expectedCacheFile = join(cacheRoot, "opencode", "models.json")

    // when
    const result = await checkModels()
    const issue = result.issues.find((candidate) => candidate.title === "Model cache not found")

    // then
    expect(issue?.description).toContain(expectedCacheFile)
    expect(issue?.fix).toContain("opencode models --refresh")
  })
})
