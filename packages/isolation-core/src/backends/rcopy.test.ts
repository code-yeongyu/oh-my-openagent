import { expect, test } from "bun:test"
import { chmod, lstat, readFile, stat, symlink, utimes, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fixture } from "../test-fixture"
import { RcopyBackend } from "./rcopy"

import { git, repo } from "./git-fixture"

test("rcopy seeds staged, unstaged and NUL-delimited untracked files without ignored files", async () => {
  const { repoRoot: lower, root } = await repo()
  const merged = join(root, "merged")
  await writeFile(join(lower, "staged"), "stage\n")
  await git(lower, "add", "staged")
  await writeFile(join(lower, "tracked"), "dirty\n")
  // The name must force ls-files' NUL delimitation to matter: a newline breaks
  // the non-z output outright (POSIX), and git C-quotes non-ASCII names in the
  // non-z output, so either form proves the -z round-trip. NTFS rejects the
  // control character, so win32 proves it through the quoted-escape form.
  const name = process.platform === "win32" ? "untracked-한글" : "untracked\nname"
  await writeFile(join(lower, name), "untracked")
  await chmod(join(lower, name), 0o751)
  await utimes(join(lower, name), 1234567890, 1234567890)
  await writeFile(join(lower, "ignored"), "ignored")
  const b = new RcopyBackend()
  await b.start(lower, merged, { id: "test", baseDir: root, crossDevice: false })
  expect(await readFile(join(merged, "tracked"), "utf8")).toBe("dirty\n")
  expect(await git(merged, "diff", "--cached", "--name-only")).toBe("staged")
  expect(await readFile(join(merged, name), "utf8")).toBe("untracked")
  expect(await Bun.file(join(merged, "ignored")).exists()).toBe(false)
  expect((await stat(join(merged, name))).mtimeMs).toBe(1234567890000)
  if (process.platform !== "win32") expect((await stat(join(merged, name))).mode & 0o777).toBe(0o751)
  await b.stop(merged)
  expect(await git(lower, "worktree", "list", "--porcelain")).not.toContain(merged)
})

test("rcopy plain copy preserves symlinks, refuses existing destinations and enforces byte ceiling", async () => {
  const { repoRoot: lower, root } = await fixture()
  await writeFile(join(lower, "data"), "123456")
  await symlink("data", join(lower, "link"))
  const b = new RcopyBackend()
  const ctx = { id: "test", baseDir: root, crossDevice: false, maxCopyBytes: 5 }
  await expect(b.start(lower, join(root, "too-big"), ctx)).rejects.toThrow("6")
  const merged = join(root, "merged")
  await b.start(lower, merged, { ...ctx, maxCopyBytes: 100 })
  expect((await lstat(join(merged, "link"))).isSymbolicLink()).toBe(true)
  await expect(b.start(lower, merged, { ...ctx, maxCopyBytes: 100 })).rejects.toThrow()
  await b.stop(merged)
})
