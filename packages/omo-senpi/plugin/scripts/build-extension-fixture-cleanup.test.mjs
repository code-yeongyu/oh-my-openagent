import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { dirname } from "node:path"

import { createBuildFixture } from "./build-extension.test-support.mjs"

test("file cleanup removes both build roots after the reproduction rejects", async () => {
  const roots = []
  const failure = new Error("reproduction build failed")
  const fixture = createBuildFixture(async ({ outputPath }) => {
    roots.push(dirname(outputPath))
    if (roots.length === 2) throw failure
    return {}
  })

  try {
    await fixture.sharedOutputs()
    await expect(fixture.reproductionRoot()).rejects.toBe(failure)
    expect(roots.map((root) => existsSync(root))).toEqual([true, true])
    await expect(fixture.cleanupFile()).rejects.toBe(failure)
    expect(roots.map((root) => existsSync(root))).toEqual([false, false])
  } finally {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
  }
})
