import { describe, expect, setDefaultTimeout, test } from "bun:test"

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"
import { runMemoryRepoMaintenance } from "./repo-maintenance"

// The real-git case runs 66 fetch + maintenance rounds; loaded CI runners need more than the 20 s default.
setDefaultTimeout(60_000)

type Call = readonly string[]

/** A fake git whose `count-objects -v` answers (in order, the last one repeating) and command log the test controls. */
function fakeGit(...countObjects: string[]) {
  const calls: Call[] = []
  let counted = 0
  const git = async (argv: readonly string[]): Promise<{ readonly stdout: string }> => {
    calls.push(argv)
    if (argv[0] === "count-objects") return { stdout: countObjects[Math.min(counted++, countObjects.length - 1)] ?? "" }
    return { stdout: "" }
  }
  return { calls, git }
}

const OPTIONS = { minLooseObjects: 2_000, timeoutMs: 60_000 }
const COUNTERS = (loose: number, packs: number): string =>
  `count: ${loose}\nsize: 1\nin-pack: 10\npacks: ${packs}\nsize-pack: 2\nprune-packable: 0\ngarbage: 0\n`

const GEOMETRIC_FOLD = ["repack", "-d", "-l", "--geometric=2", "--quiet"]

describe("runMemoryRepoMaintenance pack fold (#15139, #15420)", () => {
  test("#given a repo at 16 packs #when maintenance runs #then the transfer packs are folded geometrically before the loose pass", async () => {
    const { calls, git } = fakeGit(COUNTERS(3_000, 16))

    const result = await runMemoryRepoMaintenance(git, OPTIONS)

    expect(result).toEqual({ status: "packed", looseObjectsBefore: 3_000, looseObjectsAfter: 3_000 })
    expect(calls.filter((argv) => argv[0] !== "count-objects")[0]).toEqual(GEOMETRIC_FOLD)
    expect(calls.some((argv) => argv[0] === "maintenance")).toBe(true)
    expect(calls.some((argv) => argv[0] === "prune-packed")).toBe(true)
  })

  test("#given a repo past the pack bound with few loose objects #when maintenance runs #then it folds the packs and reports the counts", async () => {
    const { calls, git } = fakeGit(COUNTERS(10, 90))

    const result = await runMemoryRepoMaintenance(git, OPTIONS)

    expect(result).toEqual({ status: "skipped", looseObjects: 10, packsBefore: 90, packsAfter: 90 })
    expect(calls.filter((argv) => argv[0] !== "count-objects")[0]).toEqual(GEOMETRIC_FOLD)
    expect(calls.some((argv) => argv[0] === "maintenance")).toBe(false)
  })

  test("#given a healthy repo under both bounds #when maintenance runs #then no repack runs and the counts stay as before", async () => {
    const { calls, git } = fakeGit(COUNTERS(10, 15))

    const result = await runMemoryRepoMaintenance(git, OPTIONS)

    expect(result).toEqual({ status: "skipped", looseObjects: 10, packsBefore: 15, packsAfter: 15 })
    expect(calls.filter((argv) => argv[0] === "repack" || argv[0] === "maintenance")).toEqual([])
  })

  test("#given a fold that leaves more loose objects than the bound #when maintenance runs #then the loose pass is decided on the count after the fold (#15429 L2)", async () => {
    const { calls, git } = fakeGit(COUNTERS(10, 20), COUNTERS(3_000, 1))

    const result = await runMemoryRepoMaintenance(git, OPTIONS)

    expect(result).toEqual({ status: "packed", looseObjectsBefore: 3_000, looseObjectsAfter: 3_000 })
    expect(calls.some((argv) => argv[0] === "maintenance")).toBe(true)
  })
})

describe("runMemoryRepoMaintenance reflog expiry and prune (#15418)", () => {
  test("#given an amended-away commit with an old reflog entry and a fresh unreachable blob #when maintenance runs #then the old objects are pruned and the fresh one survives", async () => {
    // given
    const dir = mkdtempSync(join(tmpdir(), "memory-prune-"))
    const DAY_MS = 24 * 60 * 60 * 1000
    const oldDate = new Date(Date.now() - 60 * DAY_MS)
    const git = (args: readonly string[], env: Record<string, string> = {}, input?: string) =>
      execFileSync("git", args, {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, ...env },
        input,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim()
    const exists = (oid: string) => {
      try {
        git(["cat-file", "-e", oid])
        return true
      } catch {
        return false
      }
    }
    try {
      git(["init", "-q", "--initial-branch=main"])
      disableFixtureAutoMaintenance(dir)
      const identity = {
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.org",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.org",
      }
      const old = { ...identity, GIT_AUTHOR_DATE: oldDate.toISOString(), GIT_COMMITTER_DATE: oldDate.toISOString() }
      writeFileSync(join(dir, "draft.md"), "abandoned draft\n")
      git(["add", "draft.md"])
      git(["commit", "-qm", "draft"], old)
      const abandoned = git(["rev-parse", "HEAD"])
      const abandonedObjects = [abandoned, git(["rev-parse", "HEAD^{tree}"]), git(["rev-parse", "HEAD:draft.md"])]
      writeFileSync(join(dir, "draft.md"), "kept memory\n")
      git(["add", "draft.md"])
      git(["commit", "--amend", "-qm", "kept"], old)
      for (const oid of abandonedObjects)
        utimesSync(join(dir, ".git", "objects", oid.slice(0, 2), oid.slice(2)), oldDate, oldDate)
      const fresh = git(["hash-object", "-w", "--stdin"], {}, "written by a concurrent writer\n")

      // when
      await runMemoryRepoMaintenance(async (args) => ({ stdout: git(args) }), { ...OPTIONS, minLooseObjects: 1 })

      // then
      expect(abandonedObjects.map(exists)).toEqual([false, false, false])
      expect(exists(fresh)).toBe(true)
      expect(git(["show", "main:draft.md"])).toBe("kept memory")
      expect(git(["reflog", "show", "--format=%H", "main"])).not.toContain(abandoned)
    } finally {
      await removeTree(dir)
    }
  })
})

test("repeated transfers of rewritten history keep pack count and size bounded after maintenance", async () => {
  const root = mkdtempSync(join(tmpdir(), "memory-transfer-packs-"))
  const source = join(root, "source")
  const target = join(root, "target")
  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
  try {
    for (const dir of [source, target]) {
      mkdirSync(dir)
      git(dir, "init", "-q")
      disableFixtureAutoMaintenance(dir)
    }
    git(target, "config", "fetch.unpackLimit", "1")
    writeFileSync(join(source, "memory"), "stable memory content\n")
    git(source, "add", "memory")
    for (let round = 0; round < 66; round++) {
      git(
        source,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.org",
        "commit",
        ...(round === 0 ? [] : ["--amend"]),
        "--allow-empty",
        "-qm",
        `retention round ${round}`,
      )
      git(target, "fetch", "--no-tags", source, "+HEAD:refs/heads/sync")
      const before = git(target, "count-objects", "-v")
      await runMemoryRepoMaintenance(async (args) => ({ stdout: git(target, ...args) }), OPTIONS)
      const after = git(target, "count-objects", "-v")
      if (round === 15) {
        expect(before).toMatch(/^packs: 16$/m)
        expect(after).toMatch(/^packs: 1$/m)
        const packedKiB = (counts: string) => Number(/^size-pack: (\d+)$/m.exec(counts)?.[1])
        expect(packedKiB(after)).toBeLessThan(packedKiB(before))
      }
      expect(Number(/^packs: (\d+)$/m.exec(after)?.[1])).toBeLessThan(16)
      expect(Number(/^size-pack: (\d+)$/m.exec(after)?.[1])).toBeLessThan(512)
    }
    expect(git(target, "show", "sync:memory")).toBe("stable memory content\n")
  } finally {
    await removeTree(root)
  }
})
