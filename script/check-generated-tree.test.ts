import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const checker = fileURLToPath(new URL("./check-generated-tree.ts", import.meta.url))
const OUTPUT = "packages/omo-senpi/plugin/extensions/omo.js"
const DERIVED = "packages/omo-senpi/plugin/daemon-launch-spec.json"
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

// A committed tree that ignores one build output and tracks one derived file, standing in for a checkout that the
// full generated build has just written into.
function builtCheckout(): string {
  const dir = mkdtempSync(join(tmpdir(), "generated-tree-"))
  fixtures.push(dir)
  git(dir, "init", "-q", "-b", "dev")
  put(dir, ".gitignore", "/packages/omo-senpi/plugin/extensions/\n")
  put(dir, DERIVED, "spec v1\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "base")
  put(dir, OUTPUT, "bundle\n")
  return dir
}

function runCheck(dir: string): number {
  return Bun.spawnSync([process.execPath, checker], { cwd: dir }).exitCode
}

describe("generated tree invariant", () => {
  test.each([
    { name: "only ignored outputs written", change: (_dir: string) => {}, exitCode: 0 },
    {
      name: "a new output under an ignored directory",
      change: (dir: string) => put(dir, "packages/omo-senpi/plugin/extensions/omo-new.js", "new\n"),
      exitCode: 0,
    },
    {
      name: "a stale tracked derived file",
      change: (dir: string) => put(dir, DERIVED, "spec v2\n"),
      exitCode: 1,
    },
    {
      name: "an output nobody ignored",
      change: (dir: string) => put(dir, "packages/omo-senpi/plugin/unlisted-output.js", "out\n"),
      exitCode: 1,
    },
  ])("#given $name after a build #when the tree is checked #then it exits $exitCode", ({ change, exitCode }) => {
    // given
    const dir = builtCheckout()
    change(dir)

    // when
    const result = runCheck(dir)

    // then
    expect(result).toBe(exitCode)
  })
})
