import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { pidAlive, probeUntil } from "../locks/process-liveness.test-support"
import { findOpenFileHolderPids, hasOpenFileHolder } from "./open-file-holders"
import { findProcessesWorkingIn } from "./repo-in-use"

// omo #10199 r5 HIGH 2 (macOS source contract): lsof's answer is awaited, never raced. Latency is
// the behavior under test here, so the stand-in lsof deliberately answers late or never:
// - a slow but correct answer (6 s, past the 5 s deadline that used to race it) is an answer;
// - a wedged lsof (a stuck NFS mount) is cut off at the hang bound, the answer is UNKNOWN - which
//   callers treat as held, never as "no holders" - and the wedged process is killed, not leaked.

const roots: string[] = []
const realPath = process.env.PATH
afterEach(async () => {
  process.env.PATH = realPath
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function withFakeLsof(script: string): Promise<{ readonly root: string; readonly lock: string }> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-fake-lsof-")))
  roots.push(root)
  await mkdir(join(root, "bin"))
  const fakeLsof = join(root, "bin", "lsof")
  await writeFile(fakeLsof, script.replaceAll("$ROOT", root), "utf8")
  await chmod(fakeLsof, 0o755)
  const lock = join(root, "index.lock")
  await writeFile(lock, "", "utf8")
  process.env.PATH = `${join(root, "bin")}:${realPath ?? ""}`
  return { root, lock }
}

const WEDGED_LSOF = "#!/bin/sh\necho $$ > \"$ROOT/lsof.pid\"\ntrap '' TERM\nexec sleep 600\n"
const macOnly = process.platform === "win32" || process.platform === "linux"

describe("macOS lsof answers are awaited under a hang bound", () => {
  test.skipIf(macOnly)("#given lsof answers 'no holders' slower than five seconds #then the lookup reports no holders instead of indeterminate", async () => {
    // #given
    const { lock } = await withFakeLsof("#!/bin/sh\nsleep 6\nexit 1\n")

    // #when
    const holders = await findOpenFileHolderPids(lock)

    // #then
    expect(holders).toEqual([])
  }, 30_000)

  test.skipIf(macOnly)("#given a wedged lsof that never exits #when the holder lookup passes its hang bound #then the lock counts as held and lsof is killed", async () => {
    // #given
    const { root, lock } = await withFakeLsof(WEDGED_LSOF)
    const started = Date.now()

    // #when
    const holders = await findOpenFileHolderPids(lock, { lsofBoundMs: 2_000 })
    const held = await hasOpenFileHolder(lock, { lsofBoundMs: 2_000 })

    // #then
    expect(holders).toBeNull()
    expect(held).toBe(true)
    expect(Date.now() - started).toBeLessThan(15_000)
    expect(existsSync(join(root, "lsof.pid"))).toBe(true)
    const wedged = Number.parseInt(readFileSync(join(root, "lsof.pid"), "utf8"), 10)
    expect(await probeUntil(() => !pidAlive(wedged), 5_000)).toBe(true)
  }, 30_000)

  test.skipIf(macOnly)("#given an lsof cwd listing with a malformed pid line #when the repo-in-use lookup parses it #then it reports unknown, never 'nobody'", async () => {
    // #given: this process is listed, plus one entry whose pid line is not a pure number
    const { root } = await withFakeLsof(`#!/bin/sh\nprintf 'p${process.pid}\\nn/\\np12abc\\nn/elsewhere\\n'\n`)

    // #when
    const users = await findProcessesWorkingIn(root)

    // #then
    expect(users).toBeNull()
  }, 30_000)

  test.skipIf(macOnly)("#given a wedged lsof #when the repo-in-use lookup passes its hang bound #then it reports unknown, never 'nobody'", async () => {
    // #given
    const { root } = await withFakeLsof(WEDGED_LSOF)

    // #when
    const users = await findProcessesWorkingIn(root, { lsofBoundMs: 2_000 })

    // #then
    expect(users).toBeNull()
  }, 30_000)
})
