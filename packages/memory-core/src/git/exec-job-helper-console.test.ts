import * as childProcess from "node:child_process"
import { afterEach, describe, expect, mock, test } from "bun:test"

import { removeTree } from "../../../../test-support/remove-tree"
import { identityRepo, jobHelperPath, requireJobHelperWhenDemanded, runsJobHelperRows } from "./job-helper-fixtures.test-support"

requireJobHelperWhenDemanded()

// Row T12's console case (design v4.2 section 16, #8501): the helper is spawned detached (never in P's libuv job) and
// with windowsHide, and the real command still runs. The spawn is observed and passed through to the real one.
const realSpawn = childProcess.spawn
const roots: string[] = []
afterEach(async () => {
  mock.restore()
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

describe.skipIf(!runsJobHelperRows)("T12: the helper spawn keeps the console suppression (design v4.2 section 16)", () => {
  test("#given a claimed host #when a command runs through the helper #then the helper is spawned detached with windowsHide and git runs", async () => {
    const { root, paths } = await identityRepo("job-helper-console-", "t12-console")
    roots.push(root)
    const spawned: Array<{ readonly file: string; readonly options: childProcess.SpawnOptions }> = []
    mock.module("node:child_process", () => ({
      ...childProcess,
      spawn: (file: string, args: readonly string[], options: childProcess.SpawnOptions) => {
        spawned.push({ file, options })
        return realSpawn(file, args, options)
      },
    }))
    const { createNodeGitExec } = await import("./exec")

    const result = await createNodeGitExec({ jobHelper: { path: jobHelperPath() } }).run(["rev-parse", "HEAD"], { cwd: paths.repo, timeoutMs: 30_000 })

    expect(result.code).toBe(0)
    const helper = spawned.filter((call) => call.file === jobHelperPath())
    expect(helper.map((call) => ({ detached: call.options.detached, windowsHide: call.options.windowsHide }))).toEqual([{ detached: true, windowsHide: true }])
  }, 60_000)
})
