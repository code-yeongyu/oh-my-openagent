import { expect, test } from "bun:test"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { git, repo } from "../backends/git-fixture"
import { stashPop, stashPush } from "./shared"

test("a no-op stash push (dirt only inside a submodule) neither creates nor pops the user's stash", async () => {
  const f = await repo()
  // An unrelated pre-existing user stash must survive the merge's stash cycle.
  await writeFile(join(f.repoRoot, "tracked"), "user stash\n")
  await git(f.repoRoot, "stash", "push", "-m", "user")
  const userStash = await git(f.repoRoot, "rev-parse", "--verify", "refs/stash")
  // Dirt inside a submodule: status is nonempty, but nothing stashable exists for git.
  const nested = await repo()
  await git(f.repoRoot, "-c", "protocol.file.allow=always", "submodule", "add", nested.repoRoot, "nested")
  await git(f.repoRoot, "commit", "-m", "submodule")
  await writeFile(join(f.repoRoot, "nested", "tracked"), "dirty inside submodule\n")
  const stashed = await stashPush(f.repoRoot)
  expect(stashed).toBeNull()
  // A caller that trusts the return value must not touch the user's stash.
  if (stashed) await stashPop(f.repoRoot, stashed)
  expect(await git(f.repoRoot, "rev-parse", "--verify", "refs/stash")).toBe(userStash)
  expect(await readFile(join(f.repoRoot, "tracked"), "utf8")).toBe("base\n")
})

test("a created stash is restored by identity, leaving later entries alone", async () => {
  const f = await repo()
  await writeFile(join(f.repoRoot, "tracked"), "user keeps this\n")
  await git(f.repoRoot, "stash", "push", "-m", "user")
  const userStash = await git(f.repoRoot, "rev-parse", "--verify", "refs/stash")
  // The merge's own dirt: this is what the cycle must stash and restore.
  await writeFile(join(f.repoRoot, "tracked"), "merge dirt\n")
  const created = await stashPush(f.repoRoot)
  expect(created).toBeTypeOf("string")
  // Another entry lands on top between push and pop; ours must still be the one restored.
  await writeFile(join(f.repoRoot, "unrelated"), "unrelated\n")
  await git(f.repoRoot, "add", "unrelated")
  await git(f.repoRoot, "stash", "push", "-m", "other process")
  const otherStash = await git(f.repoRoot, "rev-parse", "--verify", "refs/stash")
  const warning = await stashPop(f.repoRoot, created!)
  expect(warning).toBeUndefined()
  expect(await readFile(join(f.repoRoot, "tracked"), "utf8")).toBe("merge dirt\n")
  expect(await git(f.repoRoot, "rev-parse", "--verify", "refs/stash")).toBe(otherStash)
  expect(otherStash).not.toBe(userStash)
  expect(await git(f.repoRoot, "stash", "list")).toContain("other process")
})
