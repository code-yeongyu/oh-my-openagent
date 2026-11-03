import { afterEach, expect, test } from "bun:test"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { removeTempDirs, run, tempDir } from "../memfs/hooks.test-support"

afterEach(removeTempDirs)

const packageRoot = resolve(import.meta.dir, "..", "..")

async function repoState(repo: string): Promise<{ config: string; refs: string }> {
  const refs = await run(["git", "for-each-ref", "--format=%(refname) %(objectname)"], repo)
  expect(refs.code).toBe(0)
  return { config: await readFile(join(repo, ".git", "config"), "utf8"), refs: refs.stdout }
}

test("fixture repositories never write into a git repository that encloses TMPDIR", async () => {
  // Given a scratch repository with one commit, and TMPDIR pointing at a directory inside its worktree.
  const enclosing = await tempDir("memory-enclosing-repo-")
  for (const argv of [["git", "init", "-q", "-b", "main"], ["git", "config", "commit.gpgsign", "false"]]) {
    expect((await run(argv, enclosing)).code).toBe(0)
  }
  await writeFile(join(enclosing, "README.md"), "enclosing\n")
  expect((await run(["git", "add", "README.md"], enclosing)).code).toBe(0)
  const identity = ["-c", "user.name=Enclosing", "-c", "user.email=enclosing@example.invalid"]
  expect((await run(["git", ...identity, "commit", "-q", "-m", "init"], enclosing)).code).toBe(0)
  const nestedTemp = join(enclosing, "tmp")
  await mkdir(nestedTemp)
  const before = await repoState(enclosing)

  // When the fixture-factory suite runs in its own test process with that TMPDIR.
  const child = await run([process.execPath, "test", "src/git/test-repo-config.test.ts"], packageRoot, {
    TMPDIR: nestedTemp,
    TEMP: nestedTemp,
    TMP: nestedTemp,
  })

  // Then it passes, and the enclosing repository's config and refs are byte-identical.
  expect(child.code, child.stderr).toBe(0)
  expect(await repoState(enclosing)).toEqual(before)
}, 120_000)
