import { expect, test } from "bun:test"
import { mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { fixture } from "../test-fixture"
import { repo, git } from "../backends/git-fixture"
import { nestedPath, writeArtifacts } from "./shared"
import { captureBaseline } from "../git/baseline"
import { mergeIsolatedChanges } from "./index"
import { cp } from "node:fs/promises"

test("nestedPath rejects paths that escape the root through symlinked components", async () => {
  const f = await fixture()
  const root = join(f.root, "root")
  await mkdir(join(root, "nested"), { recursive: true })
  await symlink(f.root, join(root, "nested", "escape"))
  await expect(nestedPath(root, "nested/escape/repo")).rejects.toThrow(/escape|Invalid/)
  await expect(nestedPath(root, "nested/plain")).resolves.toBe(join(root, "nested/plain"))
})

test("writeArtifacts refuses artifact destinations redirected by a pre-existing symlink", async () => {
  const f = await fixture()
  const artifactsDir = join(f.root, "artifacts")
  await mkdir(join(artifactsDir, "isolation"), { recursive: true })
  // The task id is pre-planted as a symlink pointing outside the artifacts tree.
  await symlink(f.root, join(artifactsDir, "isolation", "test"))
  const delta = { rootPatch: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n", nestedPatches: [] }
  await expect(writeArtifacts(delta, { id: "test", artifactsDir })).rejects.toThrow()
})

test("nested merge refuses a nested repository path replaced by an external symlink", async () => {
  const f = await repo()
  const inner = await repo()
  await cp(inner.repoRoot, join(f.repoRoot, "inner"), { recursive: true })
  const baseline = await captureBaseline(f.repoRoot)
  const isolationDir = join(f.root, "child")
  await cp(f.repoRoot, isolationDir, { recursive: true })
  await writeFile(join(isolationDir, "inner", "tracked"), "child edit\n")
  // After baseline capture, the source's nested repository is replaced by a symlink out.
  await rm(join(f.repoRoot, "inner"), { recursive: true, force: true })
  await symlink(f.root, join(f.repoRoot, "inner"))
  await expect(mergeIsolatedChanges({ ...f, baseline, isolationDir, id: "escape", artifactsDir: join(f.root, "artifacts"), apply: true, mode: "patch" as const })).rejects.toThrow(/escape|Invalid|symlink/)
})
