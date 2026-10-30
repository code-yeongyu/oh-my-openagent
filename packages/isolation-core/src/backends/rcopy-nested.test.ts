import { expect, test } from "bun:test"
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { git, repo } from "./git-fixture"
import { fixture } from "../test-fixture"
import { RcopyBackend } from "./rcopy"
import { ensureIsolation, cleanupIsolation } from "../ensure"
import { captureBaseline } from "../git/baseline"
import { captureDeltaPatch } from "../git/delta"
import { mergeIsolatedChanges } from "../merge"

async function nestedRepoAt(path: string) {
  await mkdir(path, { recursive: true })
  await git(path, "init")
  await git(path, "config", "user.name", "Fixture")
  await git(path, "config", "user.email", "fixture@example.invalid")
  // Match the shared repo() fixture: a system-wide autocrlf=true (the Windows
  // runner default) would rewrite every applied patch into CRLF and break the
  // byte-exact round-trip assertions below.
  await git(path, "config", "core.autocrlf", "false")
  await writeFile(join(path, "inner-file"), "inner\n")
  await git(path, "add", ".")
  await git(path, "commit", "-m", "inner")
}

test("rcopy seeds an untracked embedded repository including its git metadata", async () => {
  const f = await repo()
  await nestedRepoAt(join(f.repoRoot, "vendor", "inner"))
  const baseDir = join(f.root, "base"), merged = join(baseDir, "m")
  await new RcopyBackend().start(f.repoRoot, merged, { id: "seed", baseDir, crossDevice: false })
  expect(await readFile(join(merged, "vendor", "inner", "inner-file"), "utf8")).toBe("inner\n")
  expect(await readFile(join(merged, "vendor", "inner", ".git", "HEAD"), "utf8")).toContain("ref:")
})

test("delta capture refuses a baseline nested repository that went missing from the isolation", async () => {
  const f = await repo()
  await nestedRepoAt(join(f.repoRoot, "vendor", "inner"))
  const baseline = await captureBaseline(f.repoRoot)
  expect(baseline.nested.map((n) => n.relativePath)).toContain("vendor/inner")
  const isolationDir = join(f.root, "child")
  await cp(f.repoRoot, isolationDir, { recursive: true })
  // The state the unseeded rcopy used to publish: the nested repository never arrived.
  await rm(join(isolationDir, "vendor", "inner"), { recursive: true, force: true })
  await expect(captureDeltaPatch(isolationDir, baseline)).rejects.toThrow(/missing/)
})

test("rcopy isolation round-trips edits to an untracked embedded repository", async () => {
  const f = await repo()
  await nestedRepoAt(join(f.repoRoot, "vendor", "inner"))
  const baseline = await captureBaseline(f.repoRoot)
  const handle = await ensureIsolation({ repoRoot: f.repoRoot, homeDir: f.homeDir, id: "roundtrip", backends: [new RcopyBackend()], preferred: "rcopy" })
  try {
    await writeFile(join(handle.mergedDir, "vendor", "inner", "inner-file"), "edited\n")
    const result = await mergeIsolatedChanges({ ...f, baseline, isolationDir: handle.mergedDir, id: "roundtrip", artifactsDir: join(f.root, "artifacts"), apply: true, mode: "patch" as const })
    expect(result.nested_failed ?? []).toEqual([])
    expect(await git(join(f.repoRoot, "vendor", "inner"), "log", "-1", "--format=%s")).toBe("chore(task): isolated nested changes")
    expect(await readFile(join(f.repoRoot, "vendor", "inner", "inner-file"), "utf8")).toBe("edited\n")
  } finally { await cleanupIsolation(handle) }
})

test("rcopy teardown fails closed when worktree removal fails for a live registration", async () => {
  const f = await repo()
  const merged = join(f.root, "merged")
  await git(f.repoRoot, "worktree", "add", "--detach", merged, "HEAD")
  // Corrupt the registration back-pointer: removal fails while the admin directory is live.
  await rm(join(f.repoRoot, ".git", "worktrees", "merged", "gitdir"), { force: true })
  await expect(new RcopyBackend().stop(merged)).rejects.toThrow(/worktree remove/)
  // Fail-closed: the tree is not silently deleted while the registration remains.
  expect(await access(merged).then(() => true, () => false)).toBe(true)
})

test("rcopy teardown proceeds when the registration is already gone", async () => {
  const f = await repo()
  const merged = join(f.root, "merged")
  await git(f.repoRoot, "worktree", "add", "--detach", merged, "HEAD")
  await rm(join(f.repoRoot, ".git", "worktrees", "merged"), { recursive: true, force: true })
  await new RcopyBackend().stop(merged)
  await expect(access(merged)).rejects.toThrow()
})

test("rcopy plain copy does not descend into its own destination", async () => {
  const f = await fixture()
  const lower = join(f.root, "plain")
  await mkdir(join(lower, "nested"), { recursive: true })
  await writeFile(join(lower, "nested", "file"), "data")
  // Pathological layout (defended in depth): the destination lives inside the
  // source, as it did when a subvolume repository root stopped the device walk.
  const baseDir = join(lower, ".omo-wt", "tselfcopy")
  const merged = join(baseDir, "m")
  await mkdir(baseDir, { recursive: true })
  await new RcopyBackend().start(lower, merged, { id: "selfcopy", baseDir, crossDevice: false })
  expect(await readFile(join(merged, "nested", "file"), "utf8")).toBe("data")
  await expect(access(join(merged, ".omo-wt", "tselfcopy", "m"))).rejects.toThrow()
})
