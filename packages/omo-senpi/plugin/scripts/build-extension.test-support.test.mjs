import { access, writeFile } from "node:fs/promises"
import { expect, test } from "bun:test"

import { createBuildFixture } from "./build-extension.test-support.mjs"

// #13965: one case whose build rejected (its timeout killed the shared minifier) must not fail every later case.
test("#given the shared build rejects once #when the next case asks for it #then it rebuilds instead of reusing the rejection and removes both roots", async () => {
  // given
  const outputs = []
  let calls = 0
  const fixture = createBuildFixture({
    build: async (paths) => {
      calls += 1
      outputs.push(paths.outputPath)
      await writeFile(paths.outputPath, "built")
      if (calls === 1) throw new Error("minifier lost")
      return { mainInputs: [], taskInputs: [] }
    },
  })

  // when
  await expect(fixture.sharedOutputs()).rejects.toThrow("minifier lost")
  const second = await fixture.sharedOutputs()
  await access(outputs[1])
  await fixture.cleanupFile()

  // then
  expect(calls).toBe(2)
  expect(second.mainInputs).toEqual([])
  await expect(access(outputs[0])).rejects.toMatchObject({ code: "ENOENT" })
  await expect(access(outputs[1])).rejects.toMatchObject({ code: "ENOENT" })
})

test("#given the reproduction build rejects once #when it is asked for again #then it rebuilds and the failed root is removed", async () => {
  // given
  const outputs = []
  let calls = 0
  const fixture = createBuildFixture({
    build: async (paths) => {
      calls += 1
      outputs.push(paths.outputPath)
      await writeFile(paths.outputPath, "built")
      if (calls === 1) throw new Error("minifier lost")
    },
  })

  // when
  await expect(fixture.reproductionRoot()).rejects.toThrow("minifier lost")
  await fixture.reproductionRoot()
  await access(outputs[1])
  await fixture.cleanupFile()

  // then
  expect(calls).toBe(2)
  await expect(access(outputs[0])).rejects.toMatchObject({ code: "ENOENT" })
  await expect(access(outputs[1])).rejects.toMatchObject({ code: "ENOENT" })
})
