import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createLockRecord } from "../locks"
import { createNodeGitExec } from "./exec"
import * as jobHelper from "./job-helper"

// Row T16 (design v4.2 sections 13, 18 row 14): off win32 the floor-job path does not exist. A spy helper that would
// leave a marker if anything ever spawned it, plus a spy on the production resolver, prove neither happens through
// the two seams that take a helper (the exec runtime and the lock-record options) or through their defaults.
const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe.skipIf(process.platform === "win32")("T16: linux and darwin never resolve or spawn the helper", () => {
  test("#given a spy helper injected at both seams and a spy on the resolver #when records are created and git runs with and without injection #then the helper is never resolved nor spawned", async () => {
    // #given
    const root = realpathSync.native(await mkdtemp(join(tmpdir(), "job-helper-t16-")))
    roots.push(root)
    const marker = join(root, "spawned")
    const spy = join(root, "omo-git-job-helper")
    await writeFile(spy, `#!/bin/sh\ntouch "${marker}"\n`, "utf8")
    await chmod(spy, 0o755)
    const resolver = spyOn(jobHelper, "resolveGitJobHelper")

    try {
      // #when
      const injected = { path: spy, lingerMs: 1_000 }
      const records = [await createLockRecord("memory-write", { jobHelper: injected }), await createLockRecord("memory-write")]
      const runs = [
        await createNodeGitExec({ jobHelper: injected }).run(["init", "-q", root], { cwd: root, timeoutMs: 30_000 }),
        await createNodeGitExec({ jobHelper: injected }).run(["rev-parse", "--git-dir"], { cwd: root, timeoutMs: 30_000 }),
        await createNodeGitExec().run(["rev-parse", "--git-dir"], { cwd: root, timeoutMs: 30_000 }),
      ]

      // #then
      expect(runs.map((run) => run.code)).toEqual([0, 0, 0])
      expect(records.map((record) => record.git_activity_job)).toEqual([undefined, undefined])
      expect(resolver).not.toHaveBeenCalled()
      expect(existsSync(marker)).toBe(false)
    } finally {
      resolver.mockRestore()
    }
  }, 60_000)
})
