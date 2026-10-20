import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec, type GitExec } from "../../../git/exec"
import { createGitSyncRepo } from "./git-sync-repo"

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const exec = createNodeGitExec()
async function git(cwd: string, ...argv: string[]): Promise<string> {
  const r = await exec.run(argv, { cwd, timeoutMs: 20_000 })
  if (r.code !== 0) throw new Error(`git ${argv.join(" ")}: ${r.stderr}`)
  return r.stdout.trim()
}

async function porcelain(cwd: string): Promise<string> {
  const r = await exec.run(["status", "--porcelain"], { cwd, timeoutMs: 20_000 })
  return r.stdout.replace(/\n$/, "")
}

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-repo-"))
  dirs.push(root)
  await git(root, "init", "-q", "-b", "main")
  await git(root, "config", "user.name", "Agent")
  await git(root, "config", "user.email", "agent@example.invalid")
  await git(root, "config", "commit.gpgsign", "false")
  await writeFile(join(root, "base.md"), "base\n")
  await git(root, "add", "base.md")
  await git(root, "commit", "-q", "-m", "init")
  return root
}

test("the sync commit takes exactly its paths, as OmO Sync, leaving unrelated edits dirty and unstaged", async () => {
  const root = await repo()
  const sync = createGitSyncRepo({ root })
  await writeFile(join(root, "synced.md"), "from sync\n")
  await writeFile(join(root, "base.md"), "a person's uncaptured edit\n")
  await writeFile(join(root, "draft.md"), "untracked draft\n")
  const tree = await sync.stageTree(["synced.md"])
  await sync.commit(["synced.md"], "sync: 1 memories updated\n\nSync-Seq: 1-1\nSync-Principals: device:a")
  expect(await git(root, "rev-parse", "HEAD^{tree}")).toBe(tree)
  expect(await git(root, "log", "-1", "--format=%an <%ae>|%cn")).toBe("OmO Sync <sync@omo.invalid>|OmO Sync")
  expect(await git(root, "show", "--name-only", "--format=", "HEAD")).toBe("synced.md")
  expect(await porcelain(root)).toBe(" M base.md\n?? draft.md")
  expect(await sync.hasSyncCommit("1-1")).toBe(true)
  expect(await sync.hasSyncCommit("2-2")).toBe(false)
})

test("computing the intended tree leaves the shared index untouched", async () => {
  const root = await repo()
  const sync = createGitSyncRepo({ root })
  await writeFile(join(root, "synced.md"), "from sync\n")
  await sync.stageTree(["synced.md"])
  expect(await porcelain(root)).toBe("?? synced.md")
  expect(await sync.headTree()).toBe(await git(root, "rev-parse", "HEAD^{tree}"))
})

test("an agent commit landing while the sync commits is kept: HEAD moves by compare-and-swap and the sync retries on top", async () => {
  const root = await repo()
  let raced = false
  const racing: GitExec = {
    run: async (argv, options) => {
      if (argv[0] === "update-ref" && !raced) {
        raced = true
        await writeFile(join(root, "agent.md"), "agent\n")
        await git(root, "add", "agent.md")
        await git(root, "commit", "-q", "-m", "agent: write")
      }
      return exec.run(argv, options)
    },
  }
  const sync = createGitSyncRepo({ root, exec: racing })
  await writeFile(join(root, "synced.md"), "from sync\n")
  await sync.commit(["synced.md"], "sync: 1 memories updated\n\nSync-Seq: 3-3")
  expect(await git(root, "log", "--format=%s", "-3")).toBe("sync: 1 memories updated\nagent: write\ninit")
  expect((await git(root, "ls-tree", "--name-only", "HEAD")).split("\n").sort()).toEqual(["agent.md", "base.md", "synced.md"])
  expect(await porcelain(root)).toBe("")
})
