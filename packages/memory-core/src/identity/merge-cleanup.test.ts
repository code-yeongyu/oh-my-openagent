import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

import * as resilient from "../fs/resilient"
import { landsIn } from "../fs/spy-scope.test-support"
import { GitMemoryRepo, NoEffectiveChangesError } from "../git"
import { applyIdentityMerge } from "./merge"
import { AUTHOR, identity, lock, memoryRoot, note, removeMergeRoots } from "./merge.test-support"

afterEach(async () => {
  mock.restore()
  await removeMergeRoots()
})

/** Every directory the merge removes under `repo` fails with ENOTDIR, as when a link replaced it. */
function failRmdirUnder(repo: string): void {
  const original = resilient.rmdir
  spyOn(resilient, "rmdir").mockImplementation(async (...args: Parameters<typeof resilient.rmdir>) => {
    if (!landsIn(repo, String(args[0]))) return original(...args)
    throw Object.assign(new Error(`ENOTDIR: not a directory, rmdir '${String(args[0])}'`), { code: "ENOTDIR" })
  })
}

/** The target's commit fails with `failure`; every other repository commits normally. */
function failCommitIn(repo: string, failure: Error): void {
  const original = GitMemoryRepo.prototype.commitWrite
  spyOn(GitMemoryRepo.prototype, "commitWrite").mockImplementation(async function (
    this: GitMemoryRepo,
    ...args: Parameters<GitMemoryRepo["commitWrite"]>
  ) {
    if (this.dir !== repo) return original.apply(this, args)
    throw failure
  })
}

async function stores() {
  const root = await memoryRoot()
  const target = await identity(root, "project-aaaa1111", { "notes/base.md": note("base") }, ["/work/project"])
  const source = await identity(root, "project-feature-bbbb2222", { "fresh/deep/new.md": note("new") }, [
    "/work/project-feature",
  ])
  return { target, source }
}

describe("identity merge cleanup (#10070)", () => {
  it("#given a merge that creates new directories and is then refused at commit #when it rolls back #then the original refusal surfaces and the directories it created are gone (#12974 security review)", async () => {
    const { target, source } = await stores()
    const refusal = new Error("commit refused")
    failCommitIn(target.paths.repo, refusal)

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect(outcome).toBe(refusal)
    expect(existsSync(join(target.paths.repo, "fresh"))).toBe(false)
  }, 30_000)

  it("#given a merge refused at commit whose created directories cannot be removed #when it rolls back #then the original refusal surfaces with the cleanup failure attached", async () => {
    const { target, source } = await stores()
    const refusal = new Error("commit refused")
    failCommitIn(target.paths.repo, refusal)
    failRmdirUnder(target.paths.repo)

    const outcome = await applyIdentityMerge({
      source: source.paths,
      target: target.paths,
      lock,
      author: AUTHOR,
    }).catch((error: unknown) => error)

    expect(outcome).toBe(refusal)
    expect(String(refusal.cause)).toContain("fresh/deep")
    expect(existsSync(join(target.paths.repo, "fresh/deep/new.md"))).toBe(false)
  }, 30_000)

  it("#given a merge whose commit has no effective change and whose created directories cannot be removed #when it rolls back #then it still returns nothing-to-merge and names the directories left behind", async () => {
    const { target, source } = await stores()
    failCommitIn(target.paths.repo, new NoEffectiveChangesError(["fresh/deep/new.md"]))
    failRmdirUnder(target.paths.repo)

    const result = await applyIdentityMerge({ source: source.paths, target: target.paths, lock, author: AUTHOR })

    expect(result.status).toBe("nothing-to-merge")
    expect(result.leftoverDirs).toStrictEqual(["fresh/deep", "fresh"])
  }, 30_000)
})
