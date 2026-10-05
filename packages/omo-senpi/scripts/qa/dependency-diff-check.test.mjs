import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { EXIT_ADDED, EXIT_CLEAN, EXIT_USAGE, compareRange, listManifests, resolveCommit } from "./dependency-diff-check.mjs"
import { entriesOf, stripJsonc } from "./dependency-diff-parsers.mjs"

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "dependency-diff-check.mjs")
// os.devNull is `//./nul` on Windows which git cannot open as GIT_CONFIG_GLOBAL;
// use an empty temp file instead so the test ignores user/system git config on all platforms.
const EMPTY_GIT_CONFIG = join(mkdtempSync(join(tmpdir(), "dep-diff-git-")), ".gitconfig")
writeFileSync(EMPTY_GIT_CONFIG, "")

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "qa",
  GIT_AUTHOR_EMAIL: "qa@example.invalid",
  GIT_COMMITTER_NAME: "qa",
  GIT_COMMITTER_EMAIL: "qa@example.invalid",
  GIT_CONFIG_GLOBAL: EMPTY_GIT_CONFIG,
  GIT_CONFIG_SYSTEM: EMPTY_GIT_CONFIG,
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).trim()
}

/** Writes `files` (path -> text) into the scratch repo and commits them; returns the commit sha. */
function commit(repo, files, message) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  git(repo, ["add", "-A"])
  git(repo, ["commit", "-q", "--allow-empty", "-m", message])
  return git(repo, ["rev-parse", "HEAD"])
}

const packageJson = (dependencies, devDependencies = { typescript: "^5.0.0" }) => `${JSON.stringify({ name: "scratch", dependencies, devDependencies }, null, 2)}\n`
const bunLock = (dependencies, packages) => `{
  "lockfileVersion": 1,
  "workspaces": {
    "": { "name": "scratch", "dependencies": ${JSON.stringify(dependencies)}, },
  },
  "packages": {
${Object.entries(packages).map(([name, version]) => `    "${name}": ["${name}@${version}", "", {}, "sha512-${name}"],`).join("\n")}
  }
}
`

describe("dependency-diff-check", () => {
  let repo
  let base
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "dependency-diff-check-"))
    git(repo, ["init", "-q", "-b", "main"])
    base = commit(repo, {
      "package.json": packageJson({ zod: "^4.0.0" }),
      "bun.lock": bunLock({ zod: "^4.0.0" }, { zod: "4.0.0", typescript: "5.0.0" }),
      "packages/lib/package.json": packageJson({}, {}),
      "node_modules/ignored/package.json": packageJson({ "should-not-count": "1.0.0" }),
      "README.md": "not a manifest\n",
    }, "base")
  })
  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  test("#given only version bumps and a removal between two commits #when the range is compared #then nothing is added and the control is green", () => {
    const head = commit(repo, {
      "package.json": packageJson({ zod: "^4.4.3" }, {}),
      "bun.lock": bunLock({ zod: "^4.4.3" }, { zod: "4.4.3" }),
    }, "bump zod, drop typescript")

    const report = compareRange(repo, base, head)

    expect(report.ok).toBe(true)
    expect(report.added).toEqual([])
    expect(report.totals).toMatchObject({ files: 3, unchanged: 1, modified: 2, added: 0, changed: 3, removed: 2 })
    const lock = report.files.find((file) => file.path === "bun.lock")
    expect(lock.changed.map((entry) => entry.key)).toEqual(["packages:zod", "workspaces::dependencies:zod"])
    expect(lock.removed.map((entry) => entry.key)).toEqual(["packages:typescript"])
    expect([...listManifests(repo, head).keys()]).toEqual(["bun.lock", "package.json", "packages/lib/package.json"])
  })

  test("#given a dependency added to a manifest and its lockfile #when the range is compared #then every added entry is named and the exit code is red", () => {
    const head = commit(repo, {
      "package.json": packageJson({ zod: "^4.4.3", "left-pad": "1.3.0" }),
      "bun.lock": bunLock({ "left-pad": "1.3.0", zod: "^4.4.3" }, { "left-pad": "1.3.0", zod: "4.4.3", typescript: "5.0.0" }),
    }, "add left-pad")

    const report = compareRange(repo, base, head)
    expect(report.ok).toBe(false)
    expect(report.added.map((entry) => `${entry.path}:${entry.key}`)).toEqual([
      "bun.lock:packages:left-pad",
      "bun.lock:workspaces::dependencies:left-pad",
      "package.json:dependencies:left-pad",
    ])

    const evidenceDir = join(repo, "evidence")
    const run = spawnSync(process.execPath, [SCRIPT, "--repo", repo, "--base", base, "--head", "main", "--evidence-dir", evidenceDir], { encoding: "utf8" })
    expect(run.status).toBe(EXIT_ADDED)
    expect(run.stdout).toContain("ADDED package.json :: dependencies:left-pad = 1.3.0")
    const summary = JSON.parse(run.stdout.trim().split("\n").at(-1))
    expect(summary).toMatchObject({ ok: false, exitCode: EXIT_ADDED, head, evidence: join(evidenceDir, "dependency-diff.json") })
    expect(summary.added).toContain("bun.lock:packages:left-pad")
  })

  test("#given a new package manifest with dependencies at head #when the range is compared #then its entries count as added, while a manifest deleted at head only removes", () => {
    const head = commit(repo, {
      "packages/new/package.json": packageJson({ "left-pad": "1.3.0" }, {}),
    }, "new workspace package")
    rmSync(join(repo, "packages/lib/package.json"))
    const deleted = commit(repo, {}, "drop lib")

    const report = compareRange(repo, base, head)
    expect(report.added.map((entry) => `${entry.path}:${entry.key}`)).toEqual(["packages/new/package.json:dependencies:left-pad"])
    expect(report.files.find((file) => file.path === "packages/new/package.json").status).toBe("added")

    const afterDelete = compareRange(repo, head, deleted)
    expect(afterDelete.ok).toBe(true)
    expect(afterDelete.files.find((file) => file.path === "packages/lib/package.json").status).toBe("deleted")
  })

  test("#given a changed lockfile the control cannot read #when the range is compared #then the change is unverifiable and red, never silently green", () => {
    const head = commit(repo, { "bun.lock": "{ this is not json" }, "corrupt lock")

    const report = compareRange(repo, base, head)

    expect(report.ok).toBe(false)
    expect(report.added).toEqual([])
    expect(report.unverifiable).toHaveLength(1)
    expect(report.unverifiable[0].path).toBe("bun.lock")
    expect(report.unverifiable[0].reason.startsWith("head: ")).toBe(true)
  })

  test("#given the same commit on both sides or an unknown revision #when run from the command line #then identical trees are green and a bad revision is a usage error", () => {
    const same = spawnSync(process.execPath, [SCRIPT, "--repo", repo, "--base", base, "--head", base], { encoding: "utf8" })
    expect(same.status).toBe(EXIT_CLEAN)
    expect(JSON.parse(same.stdout.trim().split("\n").at(-1))).toMatchObject({ ok: true, totals: { files: 3, unchanged: 3, added: 0 } })

    const unknown = spawnSync(process.execPath, [SCRIPT, "--repo", repo, "--base", base, "--head", "no-such-revision"], { encoding: "utf8" })
    expect(unknown.status).toBe(EXIT_USAGE)
    expect(unknown.stderr).toContain("dependency-diff-check:")
    expect(resolveCommit(repo, "main")).toBe(base)
  })

  test("#given bun.lock's JSON dialect #when parsed #then trailing commas and comments outside strings are dropped and strings keep their commas", () => {
    const text = '{ "a": [1, 2, ], /* c */ "b": "x,}", // tail\n "c": { "d": "//not-a-comment", }, }'
    expect(JSON.parse(stripJsonc(text))).toEqual({ a: [1, 2], b: "x,}", c: { d: "//not-a-comment" } })
    const entries = entriesOf("bun.lock", bunLock({ zod: "^4.0.0" }, { zod: "4.0.0" }))
    expect([...entries.entries()]).toEqual([["workspaces::dependencies:zod", "^4.0.0"], ["packages:zod", "zod@4.0.0"]])
  })
})
