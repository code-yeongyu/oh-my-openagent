import { expect, test } from "bun:test"
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { repo, git } from "../backends/git-fixture"
import { captureBaseline, IsolationBaselineTooLargeError } from "./baseline"
import { captureDeltaPatch } from "./delta"
import { parseDiffGitLinePaths } from "./synthetic-tree"
import { GitCommandError, runGit } from "./command"

async function setup() {
  const f = await repo()
  await writeFile(join(f.repoRoot, "modify"), "before\n")
  await writeFile(join(f.repoRoot, "delete"), "gone\n")
  await git(f.repoRoot, "add", ".")
  await git(f.repoRoot, "commit", "-m", "seed")
  return f
}
async function child(source: string, root: string) {
  const target = join(root, "child")
  await cp(source, target, { recursive: true })
  return target
}
const paths = (patch: string) => [...new Set(patch.split("\n").flatMap(parseDiffGitLinePaths))].sort()

test("clean baseline delta includes exactly tracked additions, modifications, deletions and untracked files", async () => {
  const { repoRoot, root } = await setup()
  const baseline = await captureBaseline(repoRoot)
  const isolated = await child(repoRoot, root)
  await writeFile(join(isolated, "modify"), "after\n")
  await rm(join(isolated, "delete"))
  await writeFile(join(isolated, "added"), "staged\n")
  await git(isolated, "add", "added")
  await writeFile(join(isolated, "untracked"), "new\n")
  const result = await captureDeltaPatch(isolated, baseline)
  expect(paths(result.rootPatch)).toEqual(["added", "delete", "modify", "untracked"])
  expect(result.nestedPatches).toEqual([])
  expect(await git(repoRoot, "status", "--porcelain")).toBe("")
})
test("parent staged, unstaged and untracked WIP is excluded", async () => {
  const { repoRoot, root } = await setup()
  await writeFile(join(repoRoot, "modify"), "staged\n")
  await git(repoRoot, "add", "modify")
  await writeFile(join(repoRoot, "modify"), "unstaged\n")
  await writeFile(join(repoRoot, "parent-wip"), "parent\n")
  const baseline = await captureBaseline(repoRoot)
  expect(baseline.root.untrackedFiles).toEqual(["parent-wip"])
  const isolated = await child(repoRoot, root)
  await writeFile(join(isolated, "child-only"), "child\n")
  expect(paths((await captureDeltaPatch(isolated, baseline)).rootPatch)).toEqual(["child-only"])
})
test("two child commits and remaining WIP are represented without child objects in parent", async () => {
  const { repoRoot, root } = await setup()
  const baseline = await captureBaseline(repoRoot)
  const isolated = await child(repoRoot, root)
  for (const name of ["first", "second"]) {
    await writeFile(join(isolated, name), `${name}\n`)
    await git(isolated, "add", name)
    await git(isolated, "commit", "-m", name)
  }
  await writeFile(join(isolated, "wip"), "pending\n")
  expect(paths((await captureDeltaPatch(isolated, baseline)).rootPatch)).toEqual(["first", "second", "wip"])
})
test("binary untracked patch applies byte-for-byte", async () => {
  const { repoRoot, root } = await setup()
  const baseline = await captureBaseline(repoRoot)
  const isolated = await child(repoRoot, root)
  const bytes = Buffer.from([0, 255, 1, 0, 128, 42])
  await writeFile(join(isolated, "binary"), bytes)
  const { rootPatch } = await captureDeltaPatch(isolated, baseline)
  expect(rootPatch).toContain("GIT binary patch")
  await runGit(["apply", "--binary", "-"], { cwd: repoRoot, input: rootPatch })
  expect(await readFile(join(repoRoot, "binary"))).toEqual(bytes)
})
test("spaces, quotes and unicode paths round-trip through patches and parsing", async () => {
  const { repoRoot, root } = await setup()
  const baseline = await captureBaseline(repoRoot)
  const isolated = await child(repoRoot, root)
  // NTFS forbids quotes and control characters in filenames; the quoted and
  // tab-separated spellings stay on filesystems that permit them.
  const posixOnly = process.platform !== "win32"
  const names = ['space name', ...(posixOnly ? ['quote"name', 'tab\tname'] as const : []), '한글']
  for (const name of names) await writeFile(join(isolated, name), "new\n")
  const { rootPatch } = await captureDeltaPatch(isolated, baseline)
  expect(paths(rootPatch)).toEqual(names.sort())
  await runGit(["apply", "--binary", "-"], { cwd: repoRoot, input: rootPatch })
  for (const name of names) expect(await readFile(join(repoRoot, name), "utf8")).toBe("new\n")
})
test("nested repository delta is separate and node_modules is excluded", async () => {
  const { repoRoot, root } = await setup()
  const nested = await repo()
  await mkdir(join(repoRoot, "libs"))
  await cp(nested.repoRoot, join(repoRoot, "libs/inner"), { recursive: true })
  await mkdir(join(repoRoot, "node_modules"))
  await cp(nested.repoRoot, join(repoRoot, "node_modules/ignored"), { recursive: true })
  const baseline = await captureBaseline(repoRoot)
  expect(baseline.nested.map(n => n.relativePath)).toEqual(["libs/inner"])
  const isolated = await child(repoRoot, root)
  await writeFile(join(isolated, "libs/inner/new"), "nested\n")
  const result = await captureDeltaPatch(isolated, baseline)
  expect(result.rootPatch).toBe("")
  expect(result.nestedPatches.map(n => n.relativePath)).toEqual(["libs/inner"])
  expect(paths(result.nestedPatches[0]!.patch)).toEqual(["new"])
})
test("untracked content over injected 1 KiB cap is refused before rendering", async () => {
  const { repoRoot } = await setup()
  await writeFile(join(repoRoot, "large"), Buffer.alloc(1025))
  await expect(captureBaseline(repoRoot, 1024)).rejects.toBeInstanceOf(IsolationBaselineTooLargeError)
})
test("staged and unstaged rendered output obey the cap", async () => {
  const { repoRoot } = await setup()
  await writeFile(join(repoRoot, "modify"), "x".repeat(2048))
  await expect(captureBaseline(repoRoot, 1024)).rejects.toBeInstanceOf(IsolationBaselineTooLargeError)
  await git(repoRoot, "add", "modify")
  await expect(captureBaseline(repoRoot, 1024)).rejects.toBeInstanceOf(IsolationBaselineTooLargeError)
})
test("ignored child files never enter the delta", async () => {
  const { repoRoot, root } = await setup()
  await writeFile(join(repoRoot, ".gitignore"), "ignored\n")
  await git(repoRoot, "add", ".gitignore")
  await git(repoRoot, "commit", "-m", "ignore")
  const baseline = await captureBaseline(repoRoot)
  const isolated = await child(repoRoot, root)
  await writeFile(join(isolated, "ignored"), "secret\n")
  expect((await captureDeltaPatch(isolated, baseline)).rootPatch).toBe("")
})
test("submodules are excluded from nested discovery", async () => {
  const { repoRoot } = await setup()
  const sub = await repo()
  await git(repoRoot, "-c", "protocol.file.allow=always", "submodule", "add", sub.repoRoot, "libs/sub")
  await git(repoRoot, "commit", "-am", "submodule")
  expect((await captureBaseline(repoRoot)).nested).toEqual([])
})
test("Git failures retain command, exit code and stderr", async () => {
  const { repoRoot } = await setup()
  try {
    await runGit(["rev-parse", "--verify", "missing-ref"], { cwd: repoRoot })
    throw new Error("expected git failure")
  } catch (error) {
    expect(error).toBeInstanceOf(GitCommandError)
    expect((error as GitCommandError).exitCode).not.toBe(0)
    expect((error as GitCommandError).stderr).toContain("fatal")
  }
})
