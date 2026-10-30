import { expect, test } from "bun:test"
import { execFile } from "node:child_process"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { repo } from "./git-fixture"

// Fixture repositories are mutated directly under .git by the tests that use
// them (objects replaced by symlinks, lock files planted, metadata detached).
// A git command that leaves a detached background process behind - commit's
// `git maintenance run --auto --detach` - would race those mutations after the
// fixture has already returned, which is exactly the EEXIST seen on macOS CI
// when maintenance recreated .git/objects between rm() and symlink().
test("fixture commits leave no detached maintenance process behind", async () => {
  const { repoRoot } = await repo()
  // The test preload turns auto maintenance off globally (#11742); this global config turns it back on, so only the
  // fixture's own repository config can keep the commit from starting it.
  const autoMaintenanceOn = join(repoRoot, ".git", "auto-maintenance-on.gitconfig")
  await writeFile(autoMaintenanceOn, "[maintenance]\n\tauto = true\n")
  const trace = await new Promise<string>((resolve, reject) => {
    execFile("git", ["-C", repoRoot, "commit", "--allow-empty", "-q", "-m", "probe"], { env: { ...process.env, GIT_TRACE: "1", GIT_CONFIG_GLOBAL: autoMaintenanceOn } }, (error, _stdout, stderr) => {
      if (error) return reject(error)
      resolve(stderr.toString())
    })
  })
  expect(trace).toContain("built-in: git commit")
  expect(trace).not.toMatch(/run_command: git (maintenance run --auto|gc --auto)/)
})
