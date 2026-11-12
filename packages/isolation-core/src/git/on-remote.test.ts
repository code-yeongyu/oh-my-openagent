import { expect, test } from "bun:test"
import { cp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { repo, git } from "../backends/git-fixture"
import { captureBaseline } from "./baseline"
import { isolatedWorkIsOnRemote } from "./on-remote"

// A retained clone used to be kept forever even when its child had committed and pushed everything:
// 8 of 14 retained clones on one machine held nothing a remote did not (2026-11-09).
async function setup() {
  const f = await repo()
  const remote = join(f.root, "remote.git")
  await git(f.root, "init", "--bare", remote)
  await git(f.repoRoot, "remote", "add", "origin", remote)
  await git(f.repoRoot, "push", "-q", "origin", "HEAD:refs/heads/main")
  await git(f.repoRoot, "fetch", "-q", "origin")
  // An untracked file in the source checkout is copied into every clone; it is not the child's work.
  await writeFile(join(f.repoRoot, "plan.md"), "the parent's plan\n")
  const baseline = await captureBaseline(f.repoRoot)
  const clone = join(f.root, "clone")
  await cp(f.repoRoot, clone, { recursive: true })
  await writeFile(join(clone, "tracked"), "child work\n")
  await git(clone, "commit", "-qam", "child work")
  return { clone, baseline }
}

test("a clone whose commits are pushed and that has no other edits holds nothing unique", async () => {
  const { clone, baseline } = await setup()
  await git(clone, "push", "-q", "origin", "HEAD:refs/heads/child")
  expect(await isolatedWorkIsOnRemote(clone, baseline)).toBe(true)
})

test("an unpushed commit is unique work", async () => {
  const { clone, baseline } = await setup()
  expect(await isolatedWorkIsOnRemote(clone, baseline)).toBe(false)
})

test("a staged or unstaged edit is unique work, even with every commit pushed", async () => {
  const { clone, baseline } = await setup()
  await git(clone, "push", "-q", "origin", "HEAD:refs/heads/child")
  await writeFile(join(clone, "tracked"), "edited after the push\n")
  expect(await isolatedWorkIsOnRemote(clone, baseline)).toBe(false)
  await git(clone, "add", "tracked")
  expect(await isolatedWorkIsOnRemote(clone, baseline)).toBe(false)
})

test("a new untracked file, or a changed copy of the parent's, is unique work", async () => {
  const { clone, baseline } = await setup()
  await git(clone, "push", "-q", "origin", "HEAD:refs/heads/child")
  await writeFile(join(clone, "notes.md"), "the child's notes\n")
  expect(await isolatedWorkIsOnRemote(clone, baseline)).toBe(false)
  const second = await setup()
  await git(second.clone, "push", "-q", "origin", "HEAD:refs/heads/child")
  await writeFile(join(second.clone, "plan.md"), "the child rewrote the plan\n")
  expect(await isolatedWorkIsOnRemote(second.clone, second.baseline)).toBe(false)
})

test("a nested repository created in the clone is kept even when every root commit is pushed", async () => {
  const { clone, baseline } = await setup()
  await git(clone, "push", "-q", "origin", "HEAD:refs/heads/child")
  const nested = join(clone, "libs", "inner")
  await mkdir(nested, { recursive: true })
  await git(nested, "init", "-q")
  await git(nested, "config", "maintenance.auto", "false")
  expect(await isolatedWorkIsOnRemote(clone, baseline)).toBe(false)
})

test("a clone with no remote-tracking refs is kept", async () => {
  const { clone, baseline } = await setup()
  await git(clone, "remote", "remove", "origin")
  expect(await isolatedWorkIsOnRemote(clone, baseline)).toBe(false)
})
