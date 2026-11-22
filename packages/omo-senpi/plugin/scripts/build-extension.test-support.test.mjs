import { spawn } from "node:child_process"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "bun:test"

import { boundBuildProgress, createBuildFixture } from "./build-extension.test-support.mjs"

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
// #13965: the cold build is bounded by its progress, not the per-test wall clock. A hung build must still fail as a
// stall, and a build whose processes burn CPU without end must fail as a runaway.
test("#given a build that makes no CPU or output progress #when it is bounded #then it fails as a stall naming the build", async () => {
  // given
  const root = await mkdtemp(join(tmpdir(), "omo-build-stall-"))
  try {
    // when
    const bounded = boundBuildProgress("shared extension build", root, new Promise(() => {}), {
      stallMs: 1_000,
      cpuCapS: 600,
    })

    // then
    await expect(bounded).rejects.toThrow(
      /^shared extension build stalled: no CPU or output progress for \d+s \(a hang\)$/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("#given a build whose process tree keeps burning CPU #when it passes the CPU cap #then it fails as a runaway naming the CPU used", async () => {
  // given
  const root = await mkdtemp(join(tmpdir(), "omo-build-runaway-"))
  const spinner = spawn(process.execPath, ["-e", "for (;;) {}"], { stdio: "ignore" })
  try {
    // when
    const bounded = boundBuildProgress("shared extension build", root, new Promise(() => {}), {
      stallMs: 60_000,
      cpuCapS: 1,
    })

    // then
    await expect(bounded).rejects.toThrow(/^shared extension build ran away: used \d+ CPU seconds \(cap 1\)$/)
  } finally {
    spinner.kill()
    await rm(root, { recursive: true, force: true })
  }
})
