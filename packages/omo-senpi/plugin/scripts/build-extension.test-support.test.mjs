import { access } from "node:fs/promises"
import { expect, test } from "bun:test"

import { createBuildFixture } from "./build-extension.test-support.mjs"

// #13965: one case whose build rejected (its timeout killed the shared minifier) must not fail every later case.
test("#given the shared build rejects once #when the next case asks for it #then it rebuilds instead of reusing the rejection", async () => {
  // given
  const roots = []
  let calls = 0
  const fixture = createBuildFixture({
    build: async (paths) => {
      calls += 1
      roots.push(paths.outputPath)
      if (calls === 1) throw new Error("minifier lost")
      return { mainInputs: [], taskInputs: [] }
    },
  })

  // when
  const first = fixture.sharedOutputs()
  await expect(first).rejects.toThrow("minifier lost")
  const second = await fixture.sharedOutputs()

  // then
  expect(calls).toBe(2)
  expect(second.mainInputs).toEqual([])
  await expect(access(roots[0])).rejects.toThrow()
  await fixture.cleanupFile()
})
