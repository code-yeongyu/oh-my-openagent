import { afterEach, describe, test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { checkTrackedOutputs } from "./check-tracked-outputs.mjs"

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root, ...args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "omo-output-tracking-"))
  roots.push(root)
  git(root, "init", "--quiet")
  const write = (name, contents = "export {}\n") => {
    const path = join(root, name)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, contents)
    return path
  }
  return { root, write }
}

describe("generated output tracking", () => {
  test("#given tracked outputs re-admitted by ignore rules #when checked #then every output passes", () => {
    const { root, write } = fixture()
    write(".gitignore", "/extensions/*\n!/extensions/omo.js\n!/extensions/gateway-rules-extension.mjs\n")
    const outputs = [write("extensions/omo.js"), write("extensions/gateway-rules-extension.mjs")]
    git(root, "add", ".")
    assert.equal(checkTrackedOutputs(root, outputs), undefined)
  })

  test("#given a generated but untracked sidecar #when checked #then its exact path is reported", () => {
    const { root, write } = fixture()
    const main = write("extensions/omo.js")
    const sidecar = write("extensions/gateway-rules-extension.mjs")
    git(root, "add", "extensions/omo.js")
    assert.deepEqual(checkTrackedOutputs(root, [main, sidecar]), { ok: false, reason: "untracked-output", output: sidecar })
  })

  test("#given a newly generated ignored sidecar #when checked #then ignore policy fails before release", () => {
    const { root, write } = fixture()
    write(".gitignore", "/extensions/*\n!/extensions/omo.js\n")
    const main = write("extensions/omo.js")
    const sidecar = write("extensions/gateway-rules-extension.mjs")
    git(root, "add", ".")
    assert.deepEqual(checkTrackedOutputs(root, [main, sidecar]), { ok: false, reason: "ignored-output", output: sidecar })
  })

  test("#given an ignored output force-added to Git #when checked #then tracking does not conceal the ignore rule", () => {
    const { root, write } = fixture()
    write(".gitignore", "/extensions/*\n")
    const sidecar = write("extensions/gateway-rules-extension.mjs")
    git(root, "add", "-f", "extensions/gateway-rules-extension.mjs")
    assert.deepEqual(checkTrackedOutputs(root, [sidecar]), { ok: false, reason: "ignored-output", output: sidecar })
  })

  test("#given an output removed from the index but still on disk #when checked #then it is not accepted", () => {
    const { root, write } = fixture()
    const sidecar = write("extensions/gateway-rules-extension.mjs")
    git(root, "add", ".")
    git(root, "rm", "--cached", "--force", "extensions/gateway-rules-extension.mjs")
    assert.deepEqual(checkTrackedOutputs(root, [sidecar]), { ok: false, reason: "untracked-output", output: sidecar })
  })

  test("#given paths with spaces and glob metacharacters #when checked #then paths are literal and NUL-delimited", () => {
    const { root, write } = fixture()
    const tracked = write("extensions/sidecar [1].mjs")
    const untracked = write("extensions/sidecar [2].mjs")
    git(root, "--literal-pathspecs", "add", "--", "extensions/sidecar [1].mjs")
    assert.equal(checkTrackedOutputs(root, [tracked]), undefined)
    assert.deepEqual(checkTrackedOutputs(root, [tracked, untracked]), { ok: false, reason: "untracked-output", output: untracked })
  })

  test("#given a linked worktree whose .git is a file #when checked #then the actual Git index is used", () => {
    const { root, write } = fixture()
    write("extensions/omo.js")
    git(root, "add", ".")
    git(root, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "--no-verify", "-m", "fixture")
    const linked = join(root, "linked-worktree")
    git(root, "worktree", "add", "--quiet", "--detach", linked)
    assert.equal(checkTrackedOutputs(linked, [join(linked, "extensions/omo.js")]), undefined)
  })

  test("#given no Git repository #when checking outputs #then Git failure cannot become a pass", () => {
    const root = mkdtempSync(join(tmpdir(), "omo-output-no-git-"))
    roots.push(root)
    const output = join(root, "omo.js")
    writeFileSync(output, "export {}\n")
    assert.throws(() => checkTrackedOutputs(root, [output]), /Cannot verify generated outputs: git/)
  })

  test("#given an output outside the repository #when checked #then it is refused explicitly", () => {
    const { root } = fixture()
    assert.throws(() => checkTrackedOutputs(root, [join(root, "..", "outside.mjs")]), /outside the repository/)
  })

  test("#given no outputs #when checked #then no Git invocation is required", () => {
    assert.equal(checkTrackedOutputs("missing-root", []), undefined)
  })
})
