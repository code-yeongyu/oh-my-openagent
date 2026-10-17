import { expect, test } from "bun:test"
import { access, cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { realpathSync } from "node:fs"

/** git prints forward-slash, fully resolved paths on win32 (8.3 names expanded);
 * the expectations compare in that form instead of the caller's spelling. POSIX
 * keeps the registered spelling verbatim — resolving there would chase /tmp
 * symlinks git never followed. */
const gitPath = (path: string) =>
  process.platform === "win32" ? realpathSync.native(path).replace(/\\/g, "/") : path
import { git, repo } from "../backends/git-fixture"
import { detachGitDir, scanNestedGitDirs } from "./detach-git-dir"
import { IsolationUnavailableError } from "../backend"
import { ensureIsolation, cleanupIsolation } from "../ensure"
import { RcopyBackend } from "../backends/rcopy"

test("linked-worktree detach uses private metadata and alternates, allowlists config and removes own registration", async () => {
  const { repoRoot: source, root } = await repo()
  await git(source, "config", "remote.origin.url", "https://example.invalid/private")
  await git(source, "config", "core.hooksPath", "/untrusted/hooks")
  const lower = join(root, "linked")
  await git(source, "worktree", "add", "--detach", lower, "HEAD")
  const merged = join(root, "merged")
  await git(lower, "worktree", "add", "--detach", merged, "HEAD")
  const admin = (await readFile(join(merged, ".git"), "utf8")).trim().slice(8)
  const common = await git(lower, "rev-parse", "--path-format=absolute", "--git-common-dir")
  expect(await detachGitDir(merged, common)).toBe("detached")
  expect(resolve(merged, await git(merged, "rev-parse", "--git-common-dir"))).toBe(join(merged, ".git"))
  expect(await git(merged, "log", "-1", "--format=%s")).toBe("fixture")
  expect(await git(source, "worktree", "list", "--porcelain")).not.toContain(gitPath(merged))
  expect(await git(source, "worktree", "list", "--porcelain")).toContain(gitPath(lower))
  await expect(lstat(admin)).rejects.toMatchObject({ code: "ENOENT" })
  const config = await readFile(join(merged, ".git/config"), "utf8")
  expect(config).not.toContain("origin")
  expect(config).not.toContain("hooksPath")
  expect(await git(merged, "config", "user.name")).toBe("Fixture")
})

test("directory metadata removes nested lock files and worktree/bare configuration; absent metadata is no-git", async () => {
  const { repoRoot, root } = await repo()
  await writeFile(join(repoRoot, ".git/index.lock"), "stale")
  await mkdir(join(repoRoot, ".git/refs/heads/nested"), { recursive: true })
  await writeFile(join(repoRoot, ".git/refs/heads/nested/ref.lock"), "stale")
  await git(repoRoot, "config", "core.worktree", root)
  await git(repoRoot, "config", "core.bare", "false")
  expect(await detachGitDir(repoRoot, join(repoRoot, ".git"))).toBe("independent")
  for (const path of ["index.lock", "refs/heads/nested/ref.lock"]) await expect(lstat(join(repoRoot, ".git", path))).rejects.toMatchObject({ code: "ENOENT" })
  expect(await readFile(join(repoRoot, ".git/config"), "utf8")).not.toMatch(/worktree|bare/)
  const empty = join(root, "empty"); await mkdir(empty)
  expect(await detachGitDir(empty, join(repoRoot, ".git"))).toBe("no-git")
})

test("copied linked metadata never deletes the source worktree admin", async () => {
  const { repoRoot, root } = await repo()
  const linked = join(root, "linked"), merged = join(root, "merged")
  await git(repoRoot, "worktree", "add", "--detach", linked, "HEAD")
  await cp(linked, merged, { recursive: true })
  await detachGitDir(merged, join(repoRoot, ".git"))
  expect(await git(linked, "status", "--porcelain")).toBe("")
  expect(await git(repoRoot, "worktree", "list", "--porcelain")).toContain(gitPath(linked))
})

test("nested relative submodule metadata remains functional; external metadata rewrites or fails closed", async () => {
  const { repoRoot: source, root } = await repo()
  const { repoRoot: sub } = await repo()
  await git(source, "-c", "protocol.file.allow=always", "submodule", "add", sub, "libs/sub")
  await git(source, "commit", "-am", "submodule")
  const merged = join(root, "merged")
  await cp(source, merged, { recursive: true })
  await detachGitDir(merged, join(source, ".git"))
  expect((await scanNestedGitDirs(merged)).nested_git_rewritten).toEqual([])
  expect(await git(join(merged, "libs/sub"), "status", "--porcelain")).toBe("")
  const absolute = join(source, ".git/modules/libs/sub")
  expect(isAbsolute(absolute)).toBe(true)
  await writeFile(join(merged, "libs/sub/.git"), `gitdir: ${absolute}\n`)
  expect((await scanNestedGitDirs(merged)).nested_git_rewritten).toEqual(["libs/sub"])
  expect(await git(join(merged, "libs/sub"), "status", "--porcelain")).toBe("")
  const foreign = join(root, "foreign")
  await mkdir(join(foreign, "libs/sub"), { recursive: true })
  await writeFile(join(foreign, "libs/sub/.git"), `gitdir: ${absolute}\n`)
  await expect(scanNestedGitDirs(foreign)).rejects.toBeInstanceOf(IsolationUnavailableError)
  await expect(scanNestedGitDirs(foreign)).rejects.toThrow("libs/sub")
})

test("ensure retries one inconsistent clone, detaches before publication, then refuses repeated corruption", async () => {
  const { repoRoot, homeDir } = await repo()
  let starts = 0
  const base = new RcopyBackend()
  const backend = {
    kind: base.kind, clonesTree: false, probe: base.probe.bind(base), stop: base.stop.bind(base),
    start: async (...args: Parameters<typeof base.start>) => {
      await base.start(...args)
      starts++
      const admin = (await readFile(join(args[1], ".git"), "utf8")).trim().slice(8)
      if (starts === 1) await writeFile(join(admin, "index"), "broken")
    },
  }
  const h = await ensureIsolation({ repoRoot, homeDir, id: "retry", backends: [backend] })
  expect(starts).toBe(2)
  expect((await lstat(join(h.mergedDir, ".git"))).isDirectory()).toBe(true)
  expect(await git(h.mergedDir, "status", "--porcelain")).toBe("")
  expect(await git(repoRoot, "worktree", "list", "--porcelain")).not.toContain(".creating-")
  await cleanupIsolation(h)
  starts = 0
  backend.start = async (...args) => {
    await base.start(...args); starts++
    const admin = (await readFile(join(args[1], ".git"), "utf8")).trim().slice(8)
    await writeFile(join(admin, "index"), "broken")
  }
  // Persistent corruption after the retry is an operational failure, not a
  // capability gap: no other backend would produce a consistent snapshot of it.
  let failure: unknown
  try { await ensureIsolation({ repoRoot, homeDir, id: "bad", backends: [backend] }) } catch (error) { failure = error }
  expect(failure).toBeInstanceOf(Error)
  expect(failure instanceof IsolationUnavailableError).toBe(false)
  expect((failure as Error).message).toContain("snapshot")
  expect(starts).toBe(2)
})

test("directory metadata rejects external symlinks beneath mutation targets", async () => {
  const { repoRoot, root } = await repo()
  await rm(join(repoRoot, ".git", "objects"), { recursive: true, force: true })
  await mkdir(join(root, "outside-objects"), { recursive: true })
  // The escape replaces a directory, so the symlink target form follows it;
  // win32 resolves a file-form link at a directory path only partially (EPERM).
  await symlink(join(root, "outside-objects"), join(repoRoot, ".git", "objects"), "dir")
  await expect(detachGitDir(repoRoot, join(repoRoot, ".git"))).rejects.toBeInstanceOf(IsolationUnavailableError)
})

test("nested directory-form git metadata is sanitized for absolute worktree targets", async () => {
  const f = await repo()
  const inner = await repo()
  await cp(inner.repoRoot, join(f.repoRoot, "inner"), { recursive: true })
  // An absolute core.worktree would keep mutating the source copy.
  await git(join(f.repoRoot, "inner"), "config", "core.worktree", inner.repoRoot)
  const result = await scanNestedGitDirs(f.repoRoot)
  expect(result.nested_git_rewritten).toEqual([])
  await expect(git(join(f.repoRoot, "inner"), "config", "--get", "core.worktree")).rejects.toThrow()
})

test("deeply nested file-form gitdir pointers are still rewritten", async () => {
  const f = await repo()
  const depth = ["a", "b", "c", "d", "e", "f", "g", "h"] // eight levels, beyond the old depth-six walk
  const deep = join(f.repoRoot, ...depth)
  await mkdir(deep, { recursive: true })
  // A linked-worktree-style .git file pointing outside the tree, with its
  // replacement already registered under .git/modules.
  await mkdir(join(f.root, "outside-admin"), { recursive: true })
  await mkdir(join(f.repoRoot, ".git", "modules", ...depth), { recursive: true })
  await writeFile(join(deep, ".git"), "gitdir: " + join(f.root, "outside-admin") + "\n")
  const result = await scanNestedGitDirs(f.repoRoot)
  expect(result.nested_git_rewritten).toContain(depth.join("/"))
})

test("admin directories outside the common worktrees area are never deleted", async () => {
  const { repoRoot: source, root } = await repo()
  const merged = join(root, "merged")
  await mkdir(merged)
  // A .git file whose admin directory back-points at us but lives outside <common>/worktrees.
  const admin = join(root, "planted-admin")
  await mkdir(admin, { recursive: true })
  await writeFile(join(admin, "gitdir"), join(merged, ".git") + "\n")
  await writeFile(join(admin, "HEAD"), "ref: refs/heads/main\n")
  await writeFile(join(merged, ".git"), "gitdir: " + admin + "\n")
  expect(await detachGitDir(merged, join(source, ".git"))).toBe("detached")
  // The back-pointer matches, but the admin directory is not a registration under
  // the source's worktrees area: it must survive untouched.
  expect(await access(admin).then(() => true, () => false)).toBe(true)
})
