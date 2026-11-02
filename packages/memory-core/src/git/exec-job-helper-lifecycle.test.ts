import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { GitHelperError } from "./errors"
import { createNodeGitExec } from "./exec"
import {
  ParkServer,
  compileHelperStub,
  environmentWith,
  forwardSlashes,
  gitOpEntries,
  identityRepo,
  jobHelperPath,
  requireJobHelperWhenDemanded,
  runsJobHelperRows,
  writeHook,
} from "./job-helper-fixtures.test-support"
import { closeHandle, exitCodeOf, isSignaled, signaledWithin, watchProcess } from "./windows-job-observer.test-support"

requireJobHelperWhenDemanded()

const roots: string[] = []
const parks: ParkServer[] = []
afterEach(async () => {
  for (const park of parks.splice(0)) await park.close()
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
    return null
  } catch (error) {
    return error
  }
}

describe.skipIf(!runsJobHelperRows)("T6: the operation's own entry is gone when run() resolves (design v4.2 section 9)", () => {
  test("#given 50 commands through the helper #when each run() resolves #then no entry remains at that moment", async () => {
    // #given
    const { root, paths } = await identityRepo("job-helper-t6-", "t6-ordering")
    roots.push(root)
    const exec = createNodeGitExec({ jobHelper: { path: jobHelperPath() } })

    for (let index = 0; index < 50; index += 1) {
      // #when
      const result = await exec.run(["rev-parse", "HEAD"], { cwd: paths.repo, timeoutMs: 30_000 })

      // #then
      expect({ index, code: result.code, entries: await gitOpEntries(paths.locks) }).toEqual({ index, code: 0, entries: [] })
    }
  }, 240_000)

  test("#given a post-commit hook whose background child lingers #when run() resolves #then the entry stays while that descendant lives and is left for the next probe after the helper exits", async () => {
    // #given
    const { root, paths, hooks } = await identityRepo("job-helper-t6l-", "t6-lingering")
    roots.push(root)
    const park = await ParkServer.start()
    parks.push(park)
    await writeHook(hooks, "post-commit", `( "$OMO_TEST_BUN" "$OMO_TEST_PARK" lingering; : ) </dev/null >/dev/null 2>&1 &\nexit 0`)
    const exec = createNodeGitExec({ jobHelper: { path: jobHelperPath(), lingerMs: 60_000 } })

    // #when
    const result = await exec.run(["-c", `core.hooksPath=${forwardSlashes(hooks)}`, "commit", "--allow-empty", "-m", "t6"], {
      cwd: paths.repo,
      timeoutMs: 60_000,
      env: environmentWith(park.hookEnvironment()),
    })
    const entries = await gitOpEntries(paths.locks)

    // #then
    expect({ code: result.code, entries: entries.length }).toEqual({ code: 0, entries: 1 })
    await park.waitFor("lingering", 30_000)
    const entry = JSON.parse(await readFile(join(paths.locks, "git-ops", entries[0] ?? ""), "utf8")) as { helper: { pid: number } }
    const helper = watchProcess(entry.helper.pid)
    expect(helper).not.toBeNull()
    try {
      expect(isSignaled(helper ?? 0n)).toBe(false)
      park.release("lingering")
      expect(await signaledWithin(helper ?? 0n, 30_000)).toBe(true)
      expect(exitCodeOf(helper ?? 0n)).toBe(0)
    } finally {
      closeHandle(helper ?? 0n)
    }
    expect(await gitOpEntries(paths.locks)).toEqual(entries)
  }, 120_000)
})

describe.skipIf(!runsJobHelperRows)("T7(a)(b): a helper that never starts leaves no entry (design v4.2 section 7.3)", () => {
  let stubDirectory = ""
  let stub = ""
  beforeAll(async () => {
    stubDirectory = await mkdtemp(join(tmpdir(), "job-helper-stub-"))
    stub = await compileHelperStub(stubDirectory)
  }, 180_000)
  afterAll(async () => {
    if (stubDirectory) await removeTree(stubDirectory, { maxRetries: 10, retryDelay: 200 })
  })

  for (const [row, mode] of [["(a) a stub that exits at once", "exit"], ["(b) a stub that never connects", "silent"]] as const) {
    test(`#given ${row} #when a command runs #then it rejects GitHelperError, git never ran and no entry exists`, async () => {
      // #given
      const { root, paths } = await identityRepo("job-helper-t7-", `t7-${mode}`)
      roots.push(root)
      const exec = createNodeGitExec({ jobHelper: { path: stub } })

      // #when
      const error = await captureError(exec.run(["tag", "t7"], {
        cwd: paths.repo,
        timeoutMs: 30_000,
        env: environmentWith({ OMO_TEST_STUB_MODE: mode }),
      }))

      // #then
      expect(error).toBeInstanceOf(GitHelperError)
      expect(await gitOpEntries(paths.locks)).toEqual([])
      const tag = await createNodeGitExec().run(["rev-parse", "--verify", "--quiet", "refs/tags/t7"], { cwd: paths.repo, timeoutMs: 30_000 })
      expect(tag.code).not.toBe(0)
    }, 60_000)
  }
})
