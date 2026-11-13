import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const checker = fileURLToPath(new URL("./check-generated-tree.ts", import.meta.url))
const LISTED = "packages/omo-senpi/plugin/extensions/omo.js"
const SOURCE = "packages/omo-senpi/plugin/scripts/install.mjs"
const fixtures: string[] = []

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): void {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
    {
      cwd: dir,
    },
  )
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
}

function put(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}

// A committed tree with one listed bundle and one PR-committed generated file, standing in for a checkout that a
// build has just rewritten.
function builtCheckout(): string {
  const dir = mkdtempSync(join(tmpdir(), "generated-tree-"))
  fixtures.push(dir)
  git(dir, "init", "-q", "-b", "dev")
  put(dir, LISTED, "bundle v1\n")
  put(dir, SOURCE, "installer v1\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "base")
  return dir
}

function runCheck(dir: string, mode: string): number {
  return Bun.spawnSync([process.execPath, checker, "--mode", mode], { cwd: dir }).exitCode
}

describe("generated tree invariant", () => {
  test.each([
    { name: "nothing changed", change: (_dir: string) => {}, pr: 0, release: 0 },
    {
      name: "a listed bundle rebuilt to new bytes",
      change: (dir: string) => put(dir, LISTED, "bundle v2\n"),
      pr: 0,
      release: 1,
    },
    {
      name: "a new output under a listed directory",
      change: (dir: string) => put(dir, "packages/omo-senpi/plugin/extensions/omo-new.js", "new\n"),
      pr: 0,
      release: 1,
    },
    {
      name: "a stale PR-committed generated file",
      change: (dir: string) => put(dir, SOURCE, "installer v2\n"),
      pr: 1,
      release: 1,
    },
    {
      name: "an output nobody listed",
      change: (dir: string) => put(dir, "packages/omo-senpi/plugin/unlisted-output.js", "out\n"),
      pr: 1,
      release: 1,
    },
  ])(
    "#given $name after a build #when the tree is checked #then pr exits $pr and release exits $release",
    ({ change, pr, release }) => {
      // given
      const dir = builtCheckout()
      change(dir)

      // when
      const exitCodes = { pr: runCheck(dir, "pr"), release: runCheck(dir, "release") }

      // then
      expect(exitCodes).toEqual({ pr, release })
    },
  )

  test("#given an unknown mode #when the tree is checked #then it refuses to run", () => {
    // given
    const dir = builtCheckout()

    // when
    const exitCode = runCheck(dir, "audit")

    // then
    expect(exitCode).toBe(2)
  })
})
