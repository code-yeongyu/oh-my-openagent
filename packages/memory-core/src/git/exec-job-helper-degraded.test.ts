import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { removeTree } from "../../../../test-support/remove-tree"
import { createLockRecord } from "../locks"
import { GitHelperError } from "./errors"
import { createNodeGitExec } from "./exec"
import {
  compileHelperStub,
  environmentWith,
  gitOpEntries,
  gitSucceeds,
  identityRepo,
  requireJobHelperWhenDemanded,
  runsJobHelperRows,
} from "./job-helper-fixtures.test-support"

requireJobHelperWhenDemanded()

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
})

describe.skipIf(!runsJobHelperRows)("T14: degraded environments (design v4.2 section 13)", () => {
  let stubDirectory = ""
  let stub = ""
  beforeAll(async () => {
    stubDirectory = await mkdtemp(join(tmpdir(), "job-helper-t14-stub-"))
    stub = await compileHelperStub(stubDirectory)
  }, 180_000)
  afterAll(async () => {
    if (stubDirectory) await removeTree(stubDirectory, { maxRetries: 10, retryDelay: 200 })
  })

  test("#given a helper path that does not exist at both seams #when a record is created and git runs #then nothing claims win32-job-v1 and git runs untracked as today", async () => {
    // #given
    const { root, paths } = await identityRepo("job-helper-t14a-", "t14-absent")
    roots.push(root)
    const jobHelper = { path: join(root, "missing", "omo-git-job-helper.exe") }

    // #when
    const record = await createLockRecord("memory-write", { jobHelper })
    const result = await createNodeGitExec({ jobHelper }).run(["tag", "t14-absent"], { cwd: paths.repo, timeoutMs: 30_000 })

    // #then
    expect(record.git_activity_job).toBeUndefined()
    expect(result.code).toBe(0)
    expect(gitSucceeds(paths.repo, ["rev-parse", "--verify", "--quiet", "refs/tags/t14-absent"])).toBe(true)
    expect(await gitOpEntries(paths.locks)).toEqual([])
  }, 60_000)

  test("#given a helper whose selftest passes but whose run mode fails assign #when git runs #then the record claims the protocol and the command fails GitHelperError without running untracked", async () => {
    // #given
    const { root, paths } = await identityRepo("job-helper-t14b-", "t14-claimed-failing")
    roots.push(root)
    const jobHelper = { path: stub }

    // #when
    const record = await createLockRecord("memory-write", { jobHelper })
    const failure = await createNodeGitExec({ jobHelper })
      .run(["tag", "t14-failing"], { cwd: paths.repo, timeoutMs: 30_000, env: environmentWith({ OMO_TEST_STUB_MODE: "assign-fails" }) })
      .then(() => null, (error: unknown) => error)

    // #then
    expect(record.git_activity_job).toBe("win32-job-v1")
    expect(failure).toBeInstanceOf(GitHelperError)
    expect(String(failure)).toContain("assign")
    expect(gitSucceeds(paths.repo, ["rev-parse", "--verify", "--quiet", "refs/tags/t14-failing"])).toBe(false)
    expect(await gitOpEntries(paths.locks)).toEqual([])
  }, 60_000)
})
