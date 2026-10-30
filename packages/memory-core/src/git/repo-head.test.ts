import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, realpathSync } from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { removeTree } from "../../../../test-support/remove-tree"
import { createNodeGitExec, GitMemoryRepo, type GitExec } from "./index"
import { disableFixtureAutoMaintenance } from "./test-repo-config.test-support"

const GIT_INTEGRATION_TEST_TIMEOUT = 60_000
const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await removeTree(root)
})

async function fixture() {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "memory-head-")))
  roots.push(root)
  const dir = join(root, "repo")
  const seed = new GitMemoryRepo({ dir, agentId: "head-test" })
  const first = await seed.init()
  disableFixtureAutoMaintenance(dir)
  const real = createNodeGitExec()
  const git = async (...argv: string[]) => {
    const result = await real.run(argv, { cwd: dir, timeoutMs: 30_000 })
    if (result.code !== 0) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  await git("commit", "--allow-empty", "-m", "second")
  const second = await git("rev-parse", "HEAD")
  let spawns = 0
  const exec: GitExec = {
    run(argv, options) {
      spawns += 1
      return real.run(argv, options)
    },
  }
  const open = (cwd = dir) => new GitMemoryRepo({ dir: cwd, agentId: "head-test", exec })
  return { root, dir, first, second, git, open, spawns: () => spawns }
}

describe("GitMemoryRepo.head filesystem fast path", () => {
  it.each(["extension", "file"] as const)(
    "#given worktree config via %s #when read #then delegates to git",
    async (source) => {
      // given
      const f = await fixture()
      if (source === "extension") await f.git("config", "extensions.worktreeConfig", "true")
      else await writeFile(join(f.dir, ".git/config.worktree"), "[core]\n\tbare = false\n")
      // when
      const head = await f.open().head()
      // then
      expect(head).toBe(f.second)
      expect(f.spawns()).toBe(1)
    },
    GIT_INTEGRATION_TEST_TIMEOUT,
  )

  it("#given detached HEAD #when read twice #then returns its SHA without spawning git", async () => {
    // given
    const f = await fixture()
    await f.git("checkout", "--detach", f.first)
    const repo = f.open()
    // when
    const heads = [await repo.head(), await repo.head()]
    // then
    expect(heads).toEqual([f.first, f.first])
    expect(f.spawns()).toBe(0)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a branch only in packed-refs #when read #then resolves it without spawning git", async () => {
    // given
    const f = await fixture()
    await f.git("pack-refs", "--all", "--prune")
    expect(existsSync(join(f.dir, ".git/refs/heads/main"))).toBe(false)
    // when
    const head = await f.open().head()
    // then
    expect(head).toBe(f.second)
    expect(f.spawns()).toBe(0)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a linked worktree with relative gitdir and packed shared refs #when read #then uses its own HEAD", async () => {
    // given
    const f = await fixture()
    const linked = join(f.root, "linked")
    await f.git("worktree", "add", "-b", "linked", linked, f.first)
    const pointer = await readFile(join(linked, ".git"), "utf8")
    const admin = pointer.trim().replace(/^gitdir: /, "")
    await writeFile(join(linked, ".git"), `gitdir: ${relative(linked, admin)}\n`)
    expect((await readFile(join(admin, "commondir"), "utf8")).trim()).toBe("../..")
    await f.git("pack-refs", "--all", "--prune")
    // when
    const head = await f.open(linked).head()
    // then
    expect(head).toBe(f.first)
    expect(f.spawns()).toBe(0)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a warm loose ref #when updated between calls #then the memo returns the new SHA", async () => {
    // given
    const f = await fixture()
    const repo = f.open()
    expect(await repo.head()).toBe(f.second)
    // when
    await f.git("update-ref", "refs/heads/main", f.first)
    const next = await repo.head()
    // then
    expect(next).toBe(f.first)
    expect(f.spawns()).toBe(0)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a warm packed ref #when repacked at another SHA #then the memo invalidates", async () => {
    // given
    const f = await fixture()
    await f.git("pack-refs", "--all", "--prune")
    const repo = f.open()
    expect(await repo.head()).toBe(f.second)
    // when
    await f.git("update-ref", "refs/heads/main", f.first)
    await f.git("pack-refs", "--all", "--prune")
    const next = await repo.head()
    // then
    expect(next).toBe(f.first)
    expect(f.spawns()).toBe(0)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a warm packed ref #when a loose override appears #then the loose value wins", async () => {
    // given
    const f = await fixture()
    await f.git("pack-refs", "--all", "--prune")
    const repo = f.open()
    expect(await repo.head()).toBe(f.second)
    // when
    await f.git("update-ref", "refs/heads/main", f.first)
    const next = await repo.head()
    // then
    expect((await readFile(join(f.dir, ".git/packed-refs"), "utf8")).split("\n"))
      .toContain(`${f.second} refs/heads/main`)
    expect(next).toBe(f.first)
    expect(f.spawns()).toBe(0)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a warm HEAD #when checkout detaches it #then a new repo instance sees the new SHA", async () => {
    // given
    const f = await fixture()
    expect(await f.open().head()).toBe(f.second)
    // when
    await f.git("checkout", "--detach", f.first)
    const next = await f.open().head()
    // then
    expect(next).toBe(f.first)
    expect(f.spawns()).toBe(0)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given an indirect symbolic branch #when read #then delegates to git", async () => {
    // given
    const f = await fixture()
    await f.git("symbolic-ref", "refs/heads/alias", "refs/heads/main")
    await f.git("symbolic-ref", "HEAD", "refs/heads/alias")
    // when
    const head = await f.open().head()
    // then
    expect(head).toBe(f.second)
    expect(f.spawns()).toBe(1)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given an unborn branch #when read #then preserves git's null result", async () => {
    // given
    const f = await fixture()
    await f.git("symbolic-ref", "HEAD", "refs/heads/unborn")
    // when
    const head = await f.open().head()
    // then
    expect(head).toBeNull()
    expect(f.spawns()).toBe(1)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given a reftable repository #when read #then delegates to git", async () => {
    // given
    const f = await fixture()
    await f.git("refs", "migrate", "--ref-format=reftable")
    // when
    const head = await f.open().head()
    // then
    expect(head).toBe(f.second)
    expect(f.spawns()).toBe(1)
  }, GIT_INTEGRATION_TEST_TIMEOUT)

  it("#given malformed loose data over a packed ref #when read #then preserves git's failure", async () => {
    // given
    const f = await fixture()
    await f.git("pack-refs", "--all", "--prune")
    await f.git("update-ref", "refs/heads/main", f.first)
    const repo = f.open()
    expect(await repo.head()).toBe(f.first)
    // when
    await writeFile(join(f.dir, ".git/refs/heads/main"), "invalid ref\n")
    const head = await repo.head()
    // then
    expect(head).toBeNull()
    expect(f.spawns()).toBe(1)
  }, GIT_INTEGRATION_TEST_TIMEOUT)
})
