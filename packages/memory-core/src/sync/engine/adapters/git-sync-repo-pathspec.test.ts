import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createNodeGitExec } from "../../../git/exec"
import { createGitSyncRepo } from "./git-sync-repo"
import { initGitSyncTestRepo } from "./git-sync-repo.test-support"

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

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "omo-sync-pathspec-"))
  dirs.push(root)
  await initGitSyncTestRepo(root)
  return root
}

/** `?` and `*` are illegal in a Windows file name, so the wildcard that platform can spell in a path is a character class; `[ab]` is glob magic to git, so the literal guarantee still has to hold there. */
const GLOB_CASES =
  process.platform === "win32"
    ? {
        files: ["set[ab].md", "seta.md", "setb.md"],
        paths: ["set[ab].md"],
        committed: ["set[ab].md"],
        untracked: ["seta.md", "setb.md"],
      }
    : {
        files: ["notes?.md", "notes1.md", "star*.md", "starlight.md", "set[ab].md", "seta.md"],
        paths: ["notes?.md", "star*.md", "set[ab].md"],
        committed: ["notes?.md", "set[ab].md", "star*.md"],
        untracked: ["notes1.md", "seta.md", "starlight.md"],
      }

test("sync paths with glob characters commit exactly the named files, never their pattern matches", async () => {
  const root = await repo()
  const sync = createGitSyncRepo({ root })
  for (const name of GLOB_CASES.files) await writeFile(join(root, name), `${name}\n`)
  await sync.commit(GLOB_CASES.paths, `sync: ${GLOB_CASES.paths.length} memories updated\n\nSync-Seq: 1-1`)
  await sync.syncIndex(GLOB_CASES.paths)
  expect((await git(root, "show", "--name-only", "--format=", "HEAD")).split("\n").sort()).toEqual(
    [...GLOB_CASES.committed].sort(),
  )
  expect(await git(root, "status", "--porcelain", "--untracked-files=all")).toBe(
    GLOB_CASES.untracked.map((name) => `?? ${name}`).join("\n"),
  )
})

test("a sync path spelled as pathspec magic is taken literally, so the person's edits stay out of the commit and the index", async () => {
  const root = await repo()
  const sync = createGitSyncRepo({ root })
  await writeFile(join(root, "base.md"), "a person's staged edit\n")
  await git(root, "add", "base.md")
  await writeFile(join(root, "other.md"), "untracked\n")
  const head = await git(root, "rev-parse", "HEAD")
  for (const magic of [":/", ":(top)", ":(glob)**"]) {
    await sync.commit([magic], "sync: 1 memories updated\n\nSync-Seq: 2-2")
    await sync.syncIndex([magic])
  }
  expect(await git(root, "diff", "--name-only", head, "HEAD")).toBe("")
  expect(await git(root, "diff", "--cached", "--name-only")).toBe("base.md")
  expect(await git(root, "ls-files")).toBe("base.md")
})
