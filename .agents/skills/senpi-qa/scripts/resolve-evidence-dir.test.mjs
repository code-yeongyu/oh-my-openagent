import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { EVIDENCE_RELATIVE_ROOT, resolveEvidenceDir } from "./resolve-evidence-dir.mjs"

const cleanupRoots = []
const cliPath = fileURLToPath(new URL("./resolve-evidence-dir.mjs", import.meta.url))

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeGitRoot() {
  const root = mkdtempSync(join(tmpdir(), "senpi-qa-evidence-"))
  cleanupRoots.push(root)
  mkdirSync(join(root, ".git"))
  return root
}

describe("resolveEvidenceDir", () => {
  test("#given a git worktree and a safe slug #when resolved #then it returns the canonical adapter evidence directory", () => {
    // given
    const repoRoot = makeGitRoot()

    // when
    const resolved = resolveEvidenceDir({ repoRoot, slug: "20260820-senpi-qa-contract" })

    // then
    expect(resolved).toBe(join(repoRoot, ".omo", "evidence", "omo-senpi-adapter", "20260820-senpi-qa-contract"))
  })

  test("#given a relative git worktree path #when resolved #then it still returns an absolute evidence directory", () => {
    // given
    const repoRoot = makeGitRoot()
    const relativeRoot = relative(process.cwd(), repoRoot)

    // when
    const resolved = resolveEvidenceDir({ repoRoot: relativeRoot, slug: "20260820-relative-root" })

    // then
    expect(resolved).toBe(join(repoRoot, ".omo", "evidence", "omo-senpi-adapter", "20260820-relative-root"))
  })

  test("#given a resolved evidence path #when the resolver returns #then it has created no directory", () => {
    // given
    const repoRoot = makeGitRoot()

    // when
    const resolved = resolveEvidenceDir({ repoRoot, slug: "20260820-senpi-qa-contract" })

    // then
    expect(existsSync(resolved)).toBe(false)
    expect(existsSync(join(repoRoot, ".omo"))).toBe(false)
  })

  test("#given the adapter evidence root #when it is the declared relative root #then it stays under .omo/evidence", () => {
    // given / when / then
    expect(EVIDENCE_RELATIVE_ROOT).toBe(join(".omo", "evidence", "omo-senpi-adapter"))
  })

  test("#given an unsafe slug #when resolved #then it is rejected before any path is produced", () => {
    // given
    const repoRoot = makeGitRoot()
    const unsafeSlugs = [
      "",
      "   ",
      ".",
      "..",
      "../escape",
      "nested/slug",
      "nested\\slug",
      "/absolute",
      join(repoRoot, "absolute"),
      "local-ignore/qa-evidence/20260819-senpi",
      "..%2Fescape",
      "-leading-hyphen",
      "trailing-hyphen-",
      "Upper-Case",
      "under_score",
    ]

    // when / then
    for (const slug of unsafeSlugs) {
      expect(() => resolveEvidenceDir({ repoRoot, slug }), `must reject ${JSON.stringify(slug)}`).toThrow()
    }
  })

  test("#given a directory that is not a git worktree #when resolved #then it is rejected", () => {
    // given
    const notARepo = mkdtempSync(join(tmpdir(), "senpi-qa-not-git-"))
    cleanupRoots.push(notARepo)

    // when / then
    expect(() => resolveEvidenceDir({ repoRoot: notARepo, slug: "20260820-senpi-qa-contract" })).toThrow(/git/i)
  })

  test("#given a rejected slug #when the error surfaces #then it names the offending slug for the operator", () => {
    // given
    const repoRoot = makeGitRoot()

    // when / then
    expect(() => resolveEvidenceDir({ repoRoot, slug: "local-ignore/qa-evidence/x" })).toThrow(
      /local-ignore\/qa-evidence\/x/,
    )
  })

  test("#given the documented Node CLI #when valid and invalid slugs run #then stdout and exit codes enforce the contract", () => {
    // given
    const repoRoot = makeGitRoot()

    // when
    const valid = spawnSync("node", [cliPath, "--repo-root", repoRoot, "--slug", "20260820-node-cli"], {
      encoding: "utf8",
    })
    const invalid = spawnSync(
      "node",
      [cliPath, "--repo-root", repoRoot, "--slug", "local-ignore/qa-evidence/x"],
      { encoding: "utf8" },
    )

    // then
    expect(valid.status).toBe(0)
    expect(valid.stdout.trim()).toBe(join(repoRoot, EVIDENCE_RELATIVE_ROOT, "20260820-node-cli"))
    expect(invalid.status).toBe(1)
    expect(invalid.stderr).toContain("local-ignore/qa-evidence/x")
  })

  test("#given a symlink to the documented Node CLI #when invoked #then the entrypoint still enforces the contract", () => {
    // given
    const repoRoot = makeGitRoot()
    const symlinkPath = join(repoRoot, "resolve-evidence-dir.mjs")
    symlinkSync(cliPath, symlinkPath)

    // when
    const result = spawnSync(
      "node",
      [symlinkPath, "--repo-root", repoRoot, "--slug", "20260820-symlink-cli"],
      { encoding: "utf8" },
    )

    // then
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe(join(repoRoot, EVIDENCE_RELATIVE_ROOT, "20260820-symlink-cli"))
  })

  test("#given an embedding runner with a missing argv path #when the module is imported #then exports still load", () => {
    // given
    const missingEntrypoint = join(tmpdir(), `missing-senpi-qa-entrypoint-${process.pid}.mjs`)
    const moduleUrl = pathToFileURL(cliPath).href

    // when
    const result = spawnSync(
      "node",
      [
        "--input-type=module",
        "--eval",
        `process.argv[1] = ${JSON.stringify(missingEntrypoint)}; await import(${JSON.stringify(moduleUrl)})`,
      ],
      { encoding: "utf8" },
    )

    // then
    expect(result.status).toBe(0)
    expect(result.stdout).toBe("")
    expect(result.stderr).toBe("")
  })
})
