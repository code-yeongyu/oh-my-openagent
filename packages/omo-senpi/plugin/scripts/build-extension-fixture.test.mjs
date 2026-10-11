import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { rm, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { createBuildFixture } from "./build-extension.test-support.mjs"

test("#given a rejected shared build #when the file fixture is cleaned #then its partial tree is removed and the error is preserved", async () => {
  let root
  const failure = new Error("synthetic build failure")
  const fixture = createBuildFixture(async (paths) => {
    root = dirname(paths.outputPath)
    await writeFile(paths.outputPath, "partial")
    throw failure
  })
  try {
    await expect(fixture.sharedOutputs()).rejects.toBe(failure)
    expect(existsSync(root)).toBe(true)
    await expect(fixture.cleanupFile()).rejects.toBe(failure)
    expect(existsSync(root)).toBe(false)
  } finally {
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  }
})
