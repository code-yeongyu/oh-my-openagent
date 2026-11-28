import { describe, expect, test } from "bun:test"

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"
import { runMemoryRepoMaintenance } from "./repo-maintenance"

type Call = readonly string[]

/** A fake git whose `count-objects -v` answer and command log the test controls. */
function fakeGit(countObjects: string) {
  const calls: Call[] = []
  const git = async (argv: readonly string[]): Promise<{ readonly stdout: string }> => {
    calls.push(argv)
    if (argv[0] === "count-objects") return { stdout: countObjects }
    return { stdout: "" }
  }
  return { calls, git }
}

const OPTIONS = { minLooseObjects: 2_000, timeoutMs: 60_000 }
const COUNTERS = (loose: number, packs: number): string =>
  `count: ${loose}\nsize: 1\nin-pack: 10\npacks: ${packs}\nsize-pack: 2\nprune-packable: 0\ngarbage: 0\n`

describe("runMemoryRepoMaintenance pack fold (#15139)", () => {
  test("#given a repo at or past 64 packs #when maintenance runs #then the transfer packs are folded before the loose pass", async () => {
    const { calls, git } = fakeGit(COUNTERS(3_000, 783))

    const result = await runMemoryRepoMaintenance(git, OPTIONS)

    expect(result).toEqual({ status: "packed", looseObjectsBefore: 3_000, looseObjectsAfter: 3_000 })
    expect(calls.filter((argv) => argv[0] !== "count-objects")[0]).toEqual(["repack", "-A", "-d", "-l", "--quiet"])
    expect(calls.some((argv) => argv[0] === "maintenance")).toBe(true)
    expect(calls.some((argv) => argv[0] === "prune-packed")).toBe(true)
  })

  test("#given a repo past the pack bound with few loose objects #when maintenance runs #then it folds the packs and reports the counts", async () => {
    const { calls, git } = fakeGit(COUNTERS(10, 90))

    const result = await runMemoryRepoMaintenance(git, OPTIONS)

    expect(result).toEqual({ status: "skipped", looseObjects: 10, packsBefore: 90, packsAfter: 90 })
    expect(calls.filter((argv) => argv[0] !== "count-objects")[0]).toEqual(["repack", "-A", "-d", "-l", "--quiet"])
    expect(calls.some((argv) => argv[0] === "maintenance")).toBe(false)
  })

  test("#given a healthy repo under both bounds #when maintenance runs #then no repack runs and the counts stay as before", async () => {
    const { calls, git } = fakeGit(COUNTERS(10, 16))

    const result = await runMemoryRepoMaintenance(git, OPTIONS)

    expect(result).toEqual({ status: "skipped", looseObjects: 10, packsBefore: 16, packsAfter: 16 })
    expect(calls.filter((argv) => argv[0] !== "count-objects")).toEqual([])
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
      git(source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.org", "commit",
        ...(round === 0 ? [] : ["--amend"]), "--allow-empty", "-qm", `retention round ${round}`)
      git(target, "fetch", "--no-tags", source, "+HEAD:refs/heads/sync")
      const before = git(target, "count-objects", "-v")
      await runMemoryRepoMaintenance(async (args) => ({ stdout: git(target, ...args) }), OPTIONS)
      const after = git(target, "count-objects", "-v")
      if (round === 63) {
        expect(before).toMatch(/^packs: 64$/m)
        expect(after).toMatch(/^packs: 1$/m)
        const packedKiB = (counts: string) => Number(/^size-pack: (\d+)$/m.exec(counts)?.[1])
        expect(packedKiB(after)).toBeLessThan(packedKiB(before))
      }
      expect(Number(/^packs: (\d+)$/m.exec(after)?.[1])).toBeLessThan(64)
      expect(Number(/^size-pack: (\d+)$/m.exec(after)?.[1])).toBeLessThan(512)
    }
    expect(git(target, "show", "sync:memory")).toBe("stable memory content\n")
  } finally {
    await removeTree(root)
  }
}, 60_000)
