import { spawnSync } from "node:child_process"
import { Worker } from "node:worker_threads"
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, expect, test } from "bun:test"

import { killGroup } from "../../../omo-native/test/daemon-test-runner.ts"
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

// Only the guarded (POSIX) cases ask this. A zombie is gone for this purpose: it has exited and only waits for a
// reaper, which a container whose PID 1 does not reap may never provide.
function alive(pid) {
  const listed = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" })
  if (listed.status !== 0) return false
  const stat = listed.stdout.trim()
  return stat !== "" && !stat.startsWith("Z")
}

// A SIGKILLed process leaves within milliseconds; the deadline only keeps a stuck one from hanging the case, and stays
// under bun's 5 s default test timeout so a local run without --timeout still reports the alive diff.
const GONE_DEADLINE_MS = 3_000
async function waitGone(pids) {
  const deadline = Date.now() + GONE_DEADLINE_MS
  while (pids.some(alive) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
}

// A killed process is reaped on its own schedule: wait, bounded, for both the build's leader and its blocked child to
// be gone, instead of asserting at one instant.
async function expectTreeGone(error, dir) {
  const leader = Number(String(error).match(/process group (\d+)$/)?.[1])
  const blocked = Number(await readFile(join(dir, "blocked.pid"), "utf8"))
  await waitGone([leader, blocked])
  expect({ leader: alive(leader), blocked: alive(blocked) }).toEqual({ leader: false, blocked: false })
}

// The progress guard needs a tree CPU reader, which win32 does not have yet (#14832); there boundBuild reports the
// build as unmeasurable and only the hook bound applies, which the last cases pin on every platform.
const guarded = test.skipIf(process.platform === "win32")

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
guarded(
  "#given a build blocked in a synchronous child that sleeps #when it is bounded #then it fails as a stall and its process group is gone",
  async () => {
    // given
    const { dir, url } = await buildModule(blockedBuild(SLEEPS))

    // when
    const error = await rejection(
      boundBuild("shared extension build", await outputRoot(), {}, { buildModule: url, stallMs: 1_500 }),
    )

    // then
    expect(String(error)).toMatch(
      /shared extension build stalled: no CPU or output progress for \d+s \(a hang\); killed process group \d+$/,
    )
    await expectTreeGone(error, dir)
  },
)

guarded(
  "#given a build blocked in a synchronous child that spins #when its tree passes the CPU cap #then it fails as a runaway and its process group is gone",
  async () => {
    // given
    const { dir, url } = await buildModule(blockedBuild(SPINS))

    // when
    const error = await rejection(
      boundBuild("shared extension build", await outputRoot(), {}, { buildModule: url, stallMs: 60_000, cpuCapS: 1 }),
    )

    // then
    expect(String(error)).toMatch(
      /shared extension build ran away: used \d+ CPU seconds \(cap 1\); killed process group \d+$/,
    )
    await expectTreeGone(error, dir)
  },
)

// The guard samples the build's process tree, not this test process, so CPU burned here must not read as progress.
guarded(
  "#given a hung build while this test process burns CPU #when it is bounded #then it still fails as a stall",
  async () => {
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
  },
)

// #14780 review L2: a sampler that cannot read the tree disables both bounds, so it must end the build as its own
// outcome (the "unmeasurable" bound of watchTreeProgress), not pass for a stall or wait for the job limit.
guarded(
  "#given a tree sampler that always fails #when a hung build is bounded #then it fails as unmeasurable and its process group is gone",
  async () => {
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
      /shared extension build could not read its process tree's CPU for \d+s, so neither bound could be checked; killed process group \d+$/,
    )
    await expectTreeGone(error, dir)
  },
)

// #14780 review (c914af016c) M1: a kill that throws inside the exit settle used to leave the promise neither resolved
// nor rejected, so the hook hung until its outer bound. It must reject with that error instead. The sidecar kill on
// exit is a process-group signal, which only exists off win32 (#14832).
guarded(
  "#given a build that finishes #when ending its leftover process tree throws #then the build rejects with that error",
  async () => {
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
  },
)

// #14780 review (caf0705abc) L2: a kill that throws when a bound trips must still end the build: the build rejects with
// that error instead of waiting for an exit that may never come.
guarded(
  "#given a hung build #when killing its group on a tripped bound throws #then the build rejects with that error",
  async () => {
    // given
    const { dir, url } = await buildModule(blockedBuild(SLEEPS))
    const refused = new Error("group signal refused")

    // when
    const error = await rejection(
      boundBuild(
        "shared extension build",
        await outputRoot(),
        {},
        {
          buildModule: url,
          stallMs: 1_500,
          killTree: (child) => {
            killGroup(child)
            throw refused
          },
        },
      ),
    )

    // then
    expect(error).toBe(refused)
    const blocked = Number(await readFile(join(dir, "blocked.pid"), "utf8"))
    await waitGone([blocked])
    expect(alive(blocked)).toBe(false)
  },
)

// #14780 review (caf0705abc) M2/M3, scope decision: win32 has no tree CPU reader (#14832). boundBuild reports the build
// as unmeasurable once, never samples and never kills by pid; only the hook's outer bound applies.
test("#given win32 #when a build is bounded #then it is reported unmeasurable, never sampled or killed, and still resolves", async () => {
  // given
  const { url } = await buildModule("export async function buildExtension() { return { mainInputs: [] } }\n")
  const reported = []
  const never = (what) => () => {
    throw new Error(`${what} must not run on win32`)
  }

  // when
  const result = await boundBuild(
    "shared extension build",
    await outputRoot(),
    {},
    {
      buildModule: url,
      platform: "win32",
      sample: never("the tree sampler"),
      killTree: never("the group kill"),
      report: (line) => reported.push(line),
    },
  )

  // then
  expect(result).toEqual({ mainInputs: [] })
  expect(reported).toEqual([
    "shared extension build: its process tree's CPU is unmeasurable on win32 (#14832); only the hook's outer bound applies",
  ])
})

// #14780 review (7752e500ff) L4: when the group cannot be signalled, the trip ends the leader and rejects only once
// that leader has exited, as the comment on trip() says. The rest of the group is left to the caller (this case ends
// it itself); a real cleanup for that case needs the win32/tree work of #14832.
guarded(
  "#given a hung build #when its group cannot be signalled on a tripped bound #then the build rejects only after the leader exited",
  async () => {
    // given
    const { dir, url } = await buildModule(blockedBuild(SLEEPS))
    const refused = new Error("group signal refused")
    let leader

    // when
    const error = await rejection(
      boundBuild(
        "shared extension build",
        await outputRoot(),
        {},
        {
          buildModule: url,
          stallMs: 1_500,
          killTree: (child) => {
            leader = child
            throw refused
          },
        },
      ),
    )

    // then
    const leaderExited = leader.exitCode !== null || leader.signalCode !== null
    killGroup(leader)
    await waitGone([Number(await readFile(join(dir, "blocked.pid"), "utf8"))])
    expect(error).toBe(refused)
    expect(leaderExited).toBe(true)
  },
)
