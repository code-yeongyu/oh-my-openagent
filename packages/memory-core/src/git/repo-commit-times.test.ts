import { afterEach, describe, expect, it } from "bun:test"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createNodeGitExec, GitMemoryRepo, type GitExec } from "./index"
import { removeTree } from "../../../../test-support/remove-tree"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await removeTree(dir, { maxRetries: 20, retryDelay: 250 }).catch(() => undefined)
  }
})

function countingExec(): { readonly exec: GitExec; readonly logCalls: () => number; readonly logRanges: () => string[] } {
  const real = createNodeGitExec()
  const ranges: string[] = []
  return {
    exec: {
      run(argv, options) {
        if (argv[0] === "log" && argv.includes("--diff-filter=d")) ranges.push(argv[argv.length - 2] ?? "")
        return real.run(argv, options)
      },
    },
    logCalls: () => ranges.length,
    logRanges: () => [...ranges],
  }
}

async function repoWithHistory(
  steps: ReadonlyArray<{ readonly write?: Record<string, string>; readonly remove?: readonly string[]; readonly at: string }>,
  exec?: GitExec,
): Promise<{ readonly repo: GitMemoryRepo; readonly dir: string; readonly heads: string[] }> {
  const dir = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-commit-times-")))
  tempDirs.push(dir)
  const repo = new GitMemoryRepo({ dir, agentId: "agent", ...(exec === undefined ? {} : { exec }) })
  await repo.init()
  const git = createNodeGitExec()
  const heads: string[] = []
  for (const step of steps) {
    for (const [path, content] of Object.entries(step.write ?? {})) {
      await mkdir(dirname(join(dir, path)), { recursive: true })
      await writeFile(join(dir, path), content)
    }
    for (const path of step.remove ?? []) await rm(join(dir, path))
    const env = { ...process.env, GIT_AUTHOR_DATE: step.at, GIT_COMMITTER_DATE: step.at }
    await git.run(["add", "-A"], { cwd: dir, timeoutMs: 30_000, env })
    const committed = await git.run(["commit", "-q", "-m", `step at ${step.at}`], { cwd: dir, timeoutMs: 30_000, env })
    if (committed.code !== 0) throw new Error(committed.stderr)
    heads.push((await repo.head()) ?? "")
  }
  return { repo, dir, heads }
}

const seconds = (iso: string): number => Date.parse(iso) / 1000

describe("GitMemoryRepo.pathCommitTimes", () => {
  it("#given a path rewritten after another path #when read at HEAD #then each path carries its own last commit time", async () => {
    // given
    const { repo, heads } = await repoWithHistory([
      { write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" },
      { write: { "notes/b c.md": "1" }, at: "2026-01-01T00:00:02Z" },
      { write: { "a.md": "2" }, at: "2026-01-01T00:00:03Z" },
    ])

    // when
    const times = await repo.pathCommitTimes(heads[2] ?? "")

    // then
    expect(times.get("a.md")).toBe(seconds("2026-01-01T00:00:03Z"))
    expect(times.get("notes/b c.md")).toBe(seconds("2026-01-01T00:00:02Z"))
  })

  it("#given a path deleted at the revision #when read #then it is absent", async () => {
    // given
    const { repo, heads } = await repoWithHistory([
      { write: { "a.md": "1", "gone.md": "1" }, at: "2026-01-01T00:00:01Z" },
      { remove: ["gone.md"], at: "2026-01-01T00:00:02Z" },
    ])

    // when
    const times = await repo.pathCommitTimes(heads[1] ?? "")

    // then
    expect(times.has("gone.md")).toBe(false)
    expect(times.get("a.md")).toBe(seconds("2026-01-01T00:00:01Z"))
  })

  it("#given the same commit read twice #when timed #then git log runs once, and another commit recomputes", async () => {
    // given
    const counting = countingExec()
    const { repo, heads } = await repoWithHistory([
      { write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" },
      { write: { "a.md": "2" }, at: "2026-01-01T00:00:02Z" },
    ], counting.exec)
    const before = counting.logCalls()

    // when
    const first = await repo.pathCommitTimes(heads[1] ?? "")
    const second = await repo.pathCommitTimes(heads[1] ?? "")
    const older = await repo.pathCommitTimes(heads[0] ?? "")

    // then
    expect(second).toBe(first)
    expect(older.get("a.md")).toBe(seconds("2026-01-01T00:00:01Z"))
    expect(counting.logCalls() - before).toBe(2)
  })

  it("#given times already computed for an ancestor #when a descendant is read #then only the new commits are logged", async () => {
    // given
    const counting = countingExec()
    const { repo, dir, heads } = await repoWithHistory([
      { write: { "a.md": "1", "b.md": "1" }, at: "2026-01-01T00:00:01Z" },
    ], counting.exec)
    await repo.pathCommitTimes(heads[0] ?? "")
    const git = createNodeGitExec()
    const at = "2026-01-01T00:00:05Z"
    await writeFile(join(dir, "b.md"), "2")
    await writeFile(join(dir, "c.md"), "1")
    const env = { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at }
    await git.run(["add", "-A"], { cwd: dir, timeoutMs: 30_000, env })
    await git.run(["commit", "-q", "-m", "later"], { cwd: dir, timeoutMs: 30_000, env })
    const next = (await repo.head()) ?? ""

    // when
    const times = await repo.pathCommitTimes(next)

    // then
    expect(counting.logRanges().at(-1)).toBe(`${heads[0]}..${next}`)
    expect(Object.fromEntries(times)).toEqual({
      "a.md": seconds("2026-01-01T00:00:01Z"),
      "b.md": seconds(at),
      "c.md": seconds(at),
    })
  })

  it("#given times computed by an earlier process #when a new repo object reads a later revision #then it resumes from the stored revision", async () => {
    // given
    const { dir, heads } = await repoWithHistory([
      { write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" },
      { write: { "b.md": "1" }, at: "2026-01-01T00:00:02Z" },
    ])
    await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[0] ?? "")
    const counting = countingExec()
    const fresh = new GitMemoryRepo({ dir, agentId: "agent", exec: counting.exec })

    // when
    const times = await fresh.pathCommitTimes(heads[1] ?? "")

    // then
    expect(counting.logRanges()).toEqual([`${heads[0]}..${heads[1]}`])
    expect(times.get("a.md")).toBe(seconds("2026-01-01T00:00:01Z"))
    expect(times.get("b.md")).toBe(seconds("2026-01-01T00:00:02Z"))
  })

  for (const [label, store] of [
    ["truncated JSON", (revision: string) => `{"version":2,"revision":"${revision}","times":{"a.md":`],
    ["one non-integer entry in valid JSON", (revision: string) => JSON.stringify({ version: 2, revision, times: { "a.md": "soon", "b.md": 1 } })],
  ] as const) {
    it(`#given a stored cache with ${label} #when read #then the whole store is ignored and the full history answers`, async () => {
      // given
      const { dir, heads } = await repoWithHistory([
        { write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" },
        { write: { "b.md": "1" }, at: "2026-01-01T00:00:02Z" },
      ])
      await writeFile(join(dir, ".git", "omo-path-commit-times.json"), store(heads[0] ?? ""))
      const counting = countingExec()
      const fresh = new GitMemoryRepo({ dir, agentId: "agent", exec: counting.exec })

      // when
      const times = await fresh.pathCommitTimes(heads[1] ?? "")

      // then
      expect(counting.logRanges()).toEqual([heads[1] ?? ""])
      expect(times.get("a.md")).toBe(seconds("2026-01-01T00:00:01Z"))
    })
  }

  it("#given a path deleted before the stored base and re-added after it #when read warm and cold #then both give its newest touch", async () => {
    // given
    const { dir, heads } = await repoWithHistory([
      { write: { "p.md": "1", "keep.md": "1" }, at: "2030-01-01T00:00:00Z" },
      { remove: ["p.md"], at: "2026-01-02T00:00:00Z" },
      { write: { "p.md": "2" }, at: "2026-01-03T00:00:00Z" },
    ])
    await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[1] ?? "")

    // when
    const warm = await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[2] ?? "")
    await rm(join(dir, ".git", "omo-path-commit-times.json"))
    const cold = await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[2] ?? "")

    // then
    expect(warm.get("p.md")).toBe(seconds("2030-01-01T00:00:00Z"))
    expect(Object.fromEntries(warm)).toEqual(Object.fromEntries(cold))
  })

  it("#given the deleted-then-re-added path read twice in one process #when the second read builds on the first #then it still gives the newest touch", async () => {
    // given
    const { dir, heads } = await repoWithHistory([
      { write: { "p.md": "1", "keep.md": "1" }, at: "2030-01-01T00:00:00Z" },
      { remove: ["p.md"], at: "2026-01-02T00:00:00Z" },
      { write: { "p.md": "2" }, at: "2026-01-03T00:00:00Z" },
    ])
    const repo = new GitMemoryRepo({ dir, agentId: "agent" })
    await repo.pathCommitTimes(heads[1] ?? "")
    await rm(join(dir, ".git", "omo-path-commit-times.json"))

    // when
    const later = await repo.pathCommitTimes(heads[2] ?? "")

    // then
    expect(later.get("p.md")).toBe(seconds("2030-01-01T00:00:00Z"))
  })

  it("#given a merge whose side branch is dated before the trunk #when read warm and cold #then both give the newest touch", async () => {
    // given
    const { dir, heads } = await repoWithHistory([{ write: { "a.md": "1" }, at: "2026-01-01T00:00:00Z" }])
    const git = createNodeGitExec()
    const at = (iso: string) => ({ ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
    const run = (argv: readonly string[], env = process.env) => git.run(argv, { cwd: dir, timeoutMs: 30_000, env })
    await run(["checkout", "-q", "-b", "side"])
    await writeFile(join(dir, "side.md"), "side")
    await run(["add", "-A"], at("2026-03-01T00:00:00Z"))
    await run(["commit", "-q", "-m", "side"], at("2026-03-01T00:00:00Z"))
    await run(["checkout", "-q", "main"])
    await writeFile(join(dir, "a.md"), "trunk")
    await run(["add", "-A"], at("2026-05-01T00:00:00Z"))
    await run(["commit", "-q", "-m", "trunk"], at("2026-05-01T00:00:00Z"))
    await run(["merge", "-q", "--no-ff", "-m", "merge", "side"], at("2026-02-01T00:00:00Z"))
    const merged = ((await run(["rev-parse", "HEAD"])).stdout).trim()
    await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[0] ?? "")

    // when
    const warm = await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(merged)
    await rm(join(dir, ".git", "omo-path-commit-times.json"))
    const cold = await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(merged)

    // then
    expect(warm.get("side.md")).toBe(seconds("2026-03-01T00:00:00Z"))
    expect(warm.get("a.md")).toBe(seconds("2026-05-01T00:00:00Z"))
    expect(Object.fromEntries(warm)).toEqual(Object.fromEntries(cold))
  })

  it("#given a file changed only in a merge commit #when read #then the merge refreshes its time", async () => {
    // given
    const { dir } = await repoWithHistory([{ write: { "a.md": "1", "c.md": "1" }, at: "2026-01-01T00:00:00Z" }])
    const git = createNodeGitExec()
    const at = (iso: string) => ({ ...process.env, GIT_AUTHOR_DATE: iso, GIT_COMMITTER_DATE: iso })
    const run = (argv: readonly string[], env = process.env) => git.run(argv, { cwd: dir, timeoutMs: 30_000, env })
    await run(["checkout", "-q", "-b", "side"])
    await writeFile(join(dir, "a.md"), "side")
    await run(["commit", "-qam", "side"], at("2026-02-01T00:00:00Z"))
    await run(["checkout", "-q", "main"])
    await run(["merge", "-q", "--no-ff", "--no-commit", "side"], at("2026-06-01T00:00:00Z"))
    await writeFile(join(dir, "c.md"), "resolved in the merge")
    await run(["add", "-A"], at("2026-06-01T00:00:00Z"))
    await run(["commit", "-q", "-m", "merge"], at("2026-06-01T00:00:00Z"))
    const merged = ((await run(["rev-parse", "HEAD"])).stdout).trim()

    // when
    const times = await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(merged)

    // then
    expect(times.get("c.md")).toBe(seconds("2026-06-01T00:00:00Z"))
  })

  it("#given a store saved at a later revision #when an ancestor is read #then the later store is kept", async () => {
    // given
    const { dir, heads } = await repoWithHistory([
      { write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" },
      { write: { "b.md": "1" }, at: "2026-01-01T00:00:02Z" },
    ])
    await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[1] ?? "")
    const storePath = join(dir, ".git", "omo-path-commit-times.json")
    const before = await readFile(storePath, "utf8")

    // when
    await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[0] ?? "")

    // then
    expect(await readFile(storePath, "utf8")).toBe(before)
    expect(JSON.parse(before).revision).toBe(heads[1])
  })

  it("#given a git dir the store cannot be written to #when read #then the times are still returned", async () => {
    // given
    const { dir, heads } = await repoWithHistory([{ write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" }])
    await mkdir(join(dir, ".git", "omo-path-commit-times.json"))

    // when
    const times = await new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(heads[0] ?? "")

    // then
    expect(times.get("a.md")).toBe(seconds("2026-01-01T00:00:01Z"))
    expect((await readdir(join(dir, ".git"))).filter((name) => name.endsWith(".tmp"))).toEqual([])
  })

  it("#given cold reads of different revisions racing in one process #when they finish #then every read succeeds", async () => {
    // given
    const { dir, heads } = await repoWithHistory([
      { write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" },
      { write: { "b.md": "1" }, at: "2026-01-01T00:00:02Z" },
      { write: { "c.md": "1" }, at: "2026-01-01T00:00:03Z" },
      { write: { "d.md": "1" }, at: "2026-01-01T00:00:04Z" },
    ])

    // when
    const reads = await Promise.allSettled(Array.from({ length: 5 }, () =>
      heads.map((head) => new GitMemoryRepo({ dir, agentId: "agent" }).pathCommitTimes(head))).flat())

    // then
    expect(reads.filter((read) => read.status === "rejected")).toEqual([])
  }, 30_000)

  it("#given an unknown revision #when read #then it rejects with the git error instead of an empty map", async () => {
    // given
    const { repo } = await repoWithHistory([{ write: { "a.md": "1" }, at: "2026-01-01T00:00:01Z" }])

    // when
    const read = repo.pathCommitTimes("0000000000000000000000000000000000000000")

    // then
    await expect(read).rejects.toThrow(/git/i)
  })
})
