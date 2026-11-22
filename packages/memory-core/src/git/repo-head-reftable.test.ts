import { afterEach, describe, expect, it } from "bun:test"
import { execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { createNodeGitExec, GitMemoryRepo, type GitExec } from "./index"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"

const GIT_INTEGRATION_TEST_TIMEOUT = 60_000
// `git refs migrate` was measured working on git 2.55 and missing on git 2.43 ("'refs' is not a git
// command"), which also cannot read a reftable repository. Below this version the row is skipped by name.
const REFTABLE_GIT = { major: 2, minor: 55 } as const
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await removeTree(root)
})

function hostGitRunsReftable(): boolean {
  const version = /(\d+)\.(\d+)/.exec(execFileSync("git", ["--version"], { encoding: "utf8" }))
  if (version === null) return false
  const major = Number(version[1])
  return major > REFTABLE_GIT.major || (major === REFTABLE_GIT.major && Number(version[2]) >= REFTABLE_GIT.minor)
}

describe("GitMemoryRepo.head on a real reftable repository", () => {
  it.skipIf(!hostGitRunsReftable())(
    "#given a repository git 2.55 or newer migrated to reftable #when read #then git answers with the real HEAD",
    async () => {
      // given
      const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-head-reftable-")))
      roots.push(root)
      const dir = join(root, "repo")
      await new GitMemoryRepo({ dir, agentId: "head-test" }).init()
      disableFixtureAutoMaintenance(dir)
      const real = createNodeGitExec()
      const git = async (...argv: string[]) => {
        const result = await real.run(argv, { cwd: dir, timeoutMs: 30_000 })
        if (result.code !== 0) throw new Error(result.stderr)
        return result.stdout.trim()
      }
      await git("commit", "--allow-empty", "-m", "second")
      const second = await git("rev-parse", "HEAD")
      await git("refs", "migrate", "--ref-format=reftable")
      let spawns = 0
      const exec: GitExec = {
        run(argv, options) {
          spawns += 1
          return real.run(argv, options)
        },
      }
      // when
      const head = await new GitMemoryRepo({ dir, agentId: "head-test", exec }).head()
      // then
      expect(head).toBe(second)
      expect(spawns).toBe(1)
    },
    GIT_INTEGRATION_TEST_TIMEOUT,
  )
})
