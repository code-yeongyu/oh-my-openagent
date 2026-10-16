import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const parent = resolve(here, "../..")
test("preflight and explicit recovery preserve the complete pre-run clone HEAD", () => {
  const fixture = mkdtempSync(join(parent, "omo-v5134-build-recovery-test-"))
  const git = (...args) => execFileSync("git", args, { cwd: fixture, encoding: "utf8", timeout: 20_000 }).trim()
  const run = (...args) => spawnSync("bun", args, { cwd: fixture, encoding: "utf8", timeout: 60_000 })
  git("init", "-b", "integration/opencode-v2")
  git("config", "core.autocrlf", "false")
  git("config", "user.name", "Promotion Fixture")
  git("config", "user.email", "fixture@example.invalid")
  writeFileSync(join(fixture, "b.txt"), "base\n")
  git("add", "."); git("commit", "--no-verify", "-m", "base")
  const base = git("rev-parse", "HEAD")
  writeFileSync(join(fixture, "a.txt"), "first fix\n")
  git("add", "."); git("commit", "--no-verify", "-m", "first fix")
  const first = git("rev-parse", "HEAD")
  writeFileSync(join(fixture, "b.txt"), "second fix\n")
  git("add", "."); git("commit", "--no-verify", "-m", "second fix")
  const second = git("rev-parse", "HEAD")
  git("checkout", "-b", "fixture-diverged", base)
  writeFileSync(join(fixture, "b.txt"), "conflicting target\n")
  mkdirSync(join(fixture, "local-fixes/patches"), { recursive: true })
  for (const script of ["apply.mjs", "check-lineage.mjs", "promote-clone.mjs"]) copyFileSync(join(here, script), join(fixture, "local-fixes", script))
  const fixes = [first, second].map((commit, i) => {
    const patch = `patches/${i}.patch`
    writeFileSync(join(fixture, "local-fixes", patch), git("format-patch", "-1", commit, "--stdout") + "\n")
    return { id: `0${i + 1}-fixture`, title: "fixture", commit, patch, markers: [] }
  })
  writeFileSync(join(fixture, "local-fixes/manifest.json"), JSON.stringify({ fixes, build: { artifact: "dist/index.js" } }))
  git("add", "."); git("commit", "--no-verify", "-m", "conflicting baseline and harness")
  const start = git("rev-parse", "HEAD")
  const failed = run("local-fixes/promote-clone.mjs")
  assert.equal(failed.status, 1)
  assert.match(failed.stdout + failed.stderr, /FAILED WHOLE RUN/)
  assert.notEqual(git("rev-parse", "HEAD"), start, "first successful pick must be retained until explicit abort")
  const retry = run("local-fixes/promote-clone.mjs")
  assert.notEqual(retry.status, 0)
  assert.match(retry.stderr, /Previous run unresolved/)
  const aborted = run("local-fixes/promote-clone.mjs", "--abort")
  assert.equal(aborted.status, 0, aborted.stderr)
  assert.equal(git("rev-parse", "HEAD"), start)
  assert.equal(git("status", "--porcelain"), "")
  assert.equal(readFileSync(join(fixture, "b.txt"), "utf8"), "conflicting target\n")
  assert.equal(existsSync(join(fixture, "a.txt")), false)
  console.log(`Recovery fixture retained for evidence: ${fixture}`)
})
