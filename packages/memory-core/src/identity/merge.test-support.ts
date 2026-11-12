// Fixtures shared by the identity merge tests (#10070): stores with seeded files, trees porcelain refuses,
// and a fingerprint of everything a merge could touch on disk.

import { execFileSync } from "node:child_process"
import { realpathSync } from "node:fs"
import { mkdir, mkdtemp, readdir, readFile, readlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { GitMemoryRepo, type GitCommitAuthor } from "../git"
import { removeTree } from "../../../../test-support/remove-tree"
import { buildIdentityPaths } from "./layout"
import { recordIdentityBind } from "./record"

export const AUTHOR: GitCommitAuthor = {
  agentId: "merge-test",
  authorName: "Merge Test",
  authorEmail: "merge@example.com",
}
export const lock = async <T>(_domain: unknown, operation: () => Promise<T>): Promise<T> => operation()
const roots: string[] = []

export async function removeMergeRoots(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => removeTree(root, { maxRetries: 10, retryDelay: 200 })))
}

export async function memoryRoot(): Promise<string> {
  const root = realpathSync.native(await mkdtemp(join(tmpdir(), "omo-memory-merge-")))
  roots.push(root)
  return root
}

export async function identity(root: string, id: string, files: Record<string, string>, spellings: readonly string[]) {
  const paths = buildIdentityPaths(root, id)
  const repo = new GitMemoryRepo({ dir: paths.repo, agentId: AUTHOR.agentId })
  await repo.init({ authorName: AUTHOR.authorName })
  const written = Object.keys(files)
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(paths.repo, path)), { recursive: true })
    await writeFile(join(paths.repo, path), content)
  }
  if (written.length > 0) await repo.commitWrite(written, `seed ${id}`, AUTHOR)
  for (const [index, spelling] of spellings.entries()) {
    await recordIdentityBind(paths.root, { id, kind: "auto", mode: "path", source: spelling, spelling })
  }
  return { id, paths, repo }
}

export const note = (body: string) => `---\ndescription: ${body}\n---\n\n${body}\n`

export function plumb(cwd: string, args: readonly string[], input?: string): string {
  return execFileSync(
    "git",
    ["-c", "user.name=qa", "-c", "user.email=qa@example.invalid", "-c", "commit.gpgsign=false", ...args],
    { cwd, input, stdio: ["pipe", "pipe", "ignore"] },
  ).toString()
}

/**
 * Commits `path` on top of HEAD with plumbing, replacing the top-level entry of the same name. `git mktree`
 * takes any entry name (`..`, `.git`, one holding a backslash), so this builds the tree porcelain refuses to
 * build but a store can still hold: written by another tool, cloned, or carried over from another system.
 */
export function commitTreePath(repoDir: string, path: string, content: string): void {
  const names = path.split("/")
  let entry = `100644 blob ${plumb(repoDir, ["hash-object", "-w", "--stdin"], content).trim()}`
  for (const name of names.slice(1).reverse()) {
    entry = `040000 tree ${plumb(repoDir, ["mktree", "-z"], `${entry}\t${name}\0`).trim()}`
  }
  const kept = plumb(repoDir, ["ls-tree", "-z", "HEAD"])
    .split("\0")
    .filter((line) => line !== "" && !line.endsWith(`\t${names[0]}`))
  const tree = plumb(repoDir, ["mktree", "-z"], [...kept, `${entry}\t${names[0]}`, ""].join("\0")).trim()
  const commit = plumb(repoDir, ["commit-tree", tree, "-p", "HEAD", "-m", "a tree porcelain would refuse"]).trim()
  plumb(repoDir, ["update-ref", "HEAD", commit])
}

/** Every directory, file and link under `dir` (links unresolved), so a test can show what a merge touched. */
export async function fingerprint(dir: string, skip: readonly string[] = []): Promise<Record<string, string>> {
  const seen: Record<string, string> = {}
  const walk = async (current: string, label: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const name = `${label}${entry.name}`
      if (skip.includes(name)) continue
      if (entry.isSymbolicLink()) seen[name] = `link to ${await readlink(join(current, entry.name))}`
      else if (entry.isDirectory()) {
        seen[`${name}/`] = "directory"
        await walk(join(current, entry.name), `${name}/`)
      } else seen[name] = await readFile(join(current, entry.name), "utf8")
    }
  }
  await walk(dir, "")
  return seen
}

export function changedEntries(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.keys({ ...before, ...after })
    .filter((name) => before[name] !== after[name])
    .sort()
}

// Object storage and the index are rewritten by git reads; no path a merge writes can name them.
export const GIT_READ_STATE = ["repo/.git/objects", "repo/.git/index"]
