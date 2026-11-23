import { Worker } from "node:worker_threads"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, expect, test } from "bun:test"

import { boundBuild, createBuildFixture } from "./build-extension.test-support.mjs"

const scratch = []
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

// A build module in its own file, run the way the fixture runs buildExtension: in a node child process.
async function buildModule(source) {
  const dir = await mkdtemp(join(tmpdir(), "omo-build-module-"))
  scratch.push(dir)
  const path = join(dir, "build.mjs")
  await writeFile(path, source)
  return { dir, url: pathToFileURL(path).href }
}

async function outputRoot() {
  const root = await mkdtemp(join(tmpdir(), "omo-build-root-"))
  scratch.push(root)
  return root
}

// The bounded build blocks in a synchronous node child that records its pid first, so a case can check that the
// bound ended that child too. node, not sleep/ps, keeps the cases runnable on Windows.
const SLEEPS = "setTimeout(() => {}, 600_000)"
const SPINS = "for (;;) {}"
function blockedBuild(body) {
  const child = `require("node:fs").writeFileSync(process.argv[1], String(process.pid)); ${body}`
  return [
    'import { spawnSync } from "node:child_process"',
    'import { fileURLToPath } from "node:url"',
    'const pidFile = fileURLToPath(new URL("./blocked.pid", import.meta.url))',
    `export function buildExtension() { spawnSync(process.execPath, ["-e", ${JSON.stringify(child)}, pidFile]) }`,
    "",
  ].join("\n")
}

function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === "EPERM"
  }
}

// A killed process is reaped on its own schedule: wait, bounded, for both the build's leader and its blocked child to
// be gone, instead of asserting at one instant.
async function expectTreeGone(error, dir) {
  const leader = Number(String(error).match(/process (?:group|tree) (\d+)$/)?.[1])
  const blocked = Number(await readFile(join(dir, "blocked.pid"), "utf8"))
  const deadline = Date.now() + 10_000
  while ((alive(leader) || alive(blocked)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
  expect({ leader: alive(leader), blocked: alive(blocked) }).toEqual({ leader: false, blocked: false })
}

async function rejection(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error("expected the bounded build to reject")
}

// A build whose first call fails, counted across processes in a file beside the module.
const FAILS_ONCE = `
import { appendFileSync, readFileSync } from "node:fs"
import { writeFile } from "node:fs/promises"
const built = new URL("./built", import.meta.url)
export async function buildExtension(paths) {
  let calls = 0
  try { calls = readFileSync(built, "utf8").split("\\n").filter(Boolean).length } catch {}
  appendFileSync(built, paths.outputPath + "\\n")
  await writeFile(paths.outputPath, "built")
  if (calls === 0) throw new Error("minifier lost")
  return { mainInputs: [] }
}
`

async function builtOutputs(dir) {
  return (await readFile(join(dir, "built"), "utf8")).split("\n").filter(Boolean)
}

// #13965: one case whose build rejected (its timeout killed the shared minifier) must not fail every later case.
test("#given the shared build rejects once #when the next case asks for it #then it rebuilds instead of reusing the rejection and removes the roots", async () => {
  // given
  const { dir, url } = await buildModule(FAILS_ONCE)
  const fixture = createBuildFixture({ buildModule: url })

  // when
  const first = await rejection(fixture.sharedOutputs())
  const second = await fixture.sharedOutputs()
  await access(second.outputPath)
  await fixture.cleanupFile()

  // then
  const outputs = await builtOutputs(dir)
  expect(String(first)).toContain("minifier lost")
  expect(outputs).toHaveLength(2)
  expect(second.mainInputs).toEqual([])
  for (const output of outputs) await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" })
})

test("#given the reproduction build rejects once #when it is asked for again #then it rebuilds and the failed root is removed", async () => {
  // given
  const { dir, url } = await buildModule(FAILS_ONCE)
  const fixture = createBuildFixture({ buildModule: url })

  // when
  const first = await rejection(fixture.reproductionRoot())
  const root = await fixture.reproductionRoot()
  await access(join(root, "omo.js"))
  await fixture.cleanupFile()

  // then
  const outputs = await builtOutputs(dir)
  expect(String(first)).toContain("minifier lost")
  expect(outputs).toHaveLength(2)
  for (const output of outputs) await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" })
})

// #13965 B: buildExtension runs each bundler step through spawnSync, which blocks the event loop of the process that
// calls it. These builds block the same way (a synchronous child that sleeps, or one that spins), so a guard that
// samples from inside the build's own process can never pass them. The earlier cases built with async fakes, which
// left the event loop free and so stayed green while the guard could not fire on a real hung bundler.
test("#given a build blocked in a synchronous child that sleeps #when it is bounded #then it fails as a stall and its process tree is gone", async () => {
  // given
  const { dir, url } = await buildModule(blockedBuild(SLEEPS))
  const started = Date.now()

  // when
  const error = await rejection(
    boundBuild("shared extension build", await outputRoot(), {}, { buildModule: url, stallMs: 1_500 }),
  )

  // then
  expect(String(error)).toMatch(
    /shared extension build stalled: no CPU or output progress for \d+s \(a hang\); killed process (?:group|tree) \d+$/,
  )
  expect(Date.now() - started).toBeLessThan(600_000)
  await expectTreeGone(error, dir)
})

test("#given a build blocked in a synchronous child that spins #when its tree passes the CPU cap #then it fails as a runaway and its process tree is gone", async () => {
  // given
  const { dir, url } = await buildModule(blockedBuild(SPINS))

  // when
  const error = await rejection(
    boundBuild("shared extension build", await outputRoot(), {}, { buildModule: url, stallMs: 60_000, cpuCapS: 1 }),
  )

  // then
  expect(String(error)).toMatch(
    /shared extension build ran away: used \d+ CPU seconds \(cap 1\); killed process (?:group|tree) \d+$/,
  )
  await expectTreeGone(error, dir)
})

// The guard samples the build's process tree, not this test process, so CPU burned here must not read as progress.
test("#given a hung build while this test process burns CPU #when it is bounded #then it still fails as a stall", async () => {
  // given
  const { url } = await buildModule(blockedBuild(SLEEPS))
  const burner = new Worker("for (;;) {}", { eval: true })
  try {
    // when
    const error = await rejection(
      boundBuild("shared extension build", await outputRoot(), {}, { buildModule: url, stallMs: 1_500 }),
    )

    // then
    expect(String(error)).toContain("shared extension build stalled")
  } finally {
    await burner.terminate()
  }
})

// #14780 review L2: a sampler that cannot read the tree disables both bounds, so it must end the build as its own
// outcome (the "unmeasurable" bound of watchTreeProgress), not pass for a stall or wait for the job limit.
test("#given a tree sampler that always fails #when a hung build is bounded #then it fails as unmeasurable and its process tree is gone", async () => {
  // given
  const { dir, url } = await buildModule(blockedBuild(SLEEPS))

  // when
  const error = await rejection(
    boundBuild(
      "shared extension build",
      await outputRoot(),
      {},
      { buildModule: url, stallMs: 1_500, sample: () => -1 },
    ),
  )

  // then
  expect(String(error)).toMatch(
    /shared extension build could not read its process tree's CPU for \d+s, so neither bound could be checked; killed process (?:group|tree) \d+$/,
  )
  await expectTreeGone(error, dir)
})

// #14780 review (c914af016c) M1: a kill that throws inside the exit settle used to leave the promise neither resolved
// nor rejected, so the hook hung until its outer bound. It must reject with that error instead.
test("#given a build that finishes #when ending its leftover process tree throws #then the build rejects with that error", async () => {
  // given
  const { url } = await buildModule("export async function buildExtension() { return { mainInputs: [] } }\n")
  const refused = new Error("kill refused")

  // when
  const error = await rejection(
    boundBuild(
      "shared extension build",
      await outputRoot(),
      {},
      {
        buildModule: url,
        killTree: () => {
          throw refused
        },
      },
    ),
  )

  // then
  expect(error).toBe(refused)
})
