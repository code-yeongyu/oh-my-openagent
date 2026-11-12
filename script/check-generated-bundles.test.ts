import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const checker = fileURLToPath(new URL("./check-generated-bundles.ts", import.meta.url))
const realList = readFileSync(new URL("./generated-bundles.json", import.meta.url), "utf8")
const LISTED = "packages/omo-senpi/plugin/extensions/omo.js"
const SOURCE = "packages/omo-senpi/src/index.ts"
const LIST = "script/generated-bundles.json"
const fixtures: string[] = []

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(dir: string, ...args: string[]): string {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", ...args],
    {
      cwd: dir,
    },
  )
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`)
  return result.stdout.toString()
}

function put(dir: string, path: string, content: string): void {
  mkdirSync(dirname(join(dir, path)), { recursive: true })
  writeFileSync(join(dir, path), content)
}

// A repository whose base branch `dev` holds a listed bundle, a source file and its own copy of the list, with a
// `feature` branch checked out at the same commit.
function fixtureRepository(): string {
  const dir = mkdtempSync(join(tmpdir(), "generated-bundles-gate-"))
  fixtures.push(dir)
  git(dir, "init", "-q", "-b", "dev")
  put(dir, LISTED, "bundle v1\n")
  put(dir, SOURCE, "export const value = 1\n")
  put(dir, LIST, realList)
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "base")
  git(dir, "checkout", "-q", "-b", "feature")
  return dir
}

function commitAll(dir: string, message: string): void {
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", message)
}

type GateEnv = { readonly release?: string; readonly branch?: string; readonly title?: string; readonly body?: string }

function runGate(dir: string, gateEnv: GateEnv = {}): { readonly exitCode: number; readonly output: string } {
  const result = Bun.spawnSync([process.execPath, checker, "--base", "dev"], {
    cwd: dir,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? dir,
      GENERATED_GATE_RELEASE: gateEnv.release ?? "0",
      GENERATED_GATE_BRANCH: gateEnv.branch ?? "feature",
      GENERATED_GATE_TITLE: gateEnv.title ?? "fix: a feature",
      GENERATED_GATE_BODY: gateEnv.body ?? "A feature PR.",
    },
  })
  return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() }
}

const RELEASE_STATE = {
  branch: "release/v5.1.70-source-state",
  title: "release: v5.1.70",
  body: "Automated release-state PR for v5.1.70.\n",
}

describe("generated bundles gate", () => {
  test("#given a PR that changes only source #when the gate runs #then it passes", () => {
    // given
    const dir = fixtureRepository()
    put(dir, SOURCE, "export const value = 2\n")
    commitAll(dir, "change source")

    // when
    const result = runGate(dir)

    // then
    expect(result.exitCode).toBe(0)
  })

  test("#given a PR that commits a listed bundle #when the gate runs #then it fails and names the path", () => {
    // given
    const dir = fixtureRepository()
    put(dir, SOURCE, "export const value = 2\n")
    put(dir, LISTED, "bundle v2\n")
    commitAll(dir, "change source and commit the bundle")

    // when
    const result = runGate(dir)

    // then
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(LISTED)
  })

  test("#given a PR that renames a listed bundle away #when the gate runs #then the deletion still fails", () => {
    // given
    const dir = fixtureRepository()
    git(dir, "mv", LISTED, "packages/omo-senpi/plugin/omo-renamed.js")
    commitAll(dir, "rename the bundle")

    // when
    const result = runGate(dir)

    // then
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(LISTED)
  })

  test("#given a PR that edits its own copy of the list to exempt the bundle #when the gate runs #then it still fails", () => {
    // given
    const dir = fixtureRepository()
    put(dir, LIST, JSON.stringify({ patterns: ["^nothing$"] }))
    put(dir, LISTED, "bundle v2\n")
    commitAll(dir, "exempt the bundle and commit it")

    // when
    const result = runGate(dir)

    // then
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain(LISTED)
  })

  test("#given the base regenerated a bundle after the branch point #when the gate runs #then only the PR's own changes count", () => {
    // given
    const dir = fixtureRepository()
    git(dir, "checkout", "-q", "dev")
    put(dir, LISTED, "bundle v2 from the release commit\n")
    commitAll(dir, "release commit")
    git(dir, "checkout", "-q", "feature")
    put(dir, SOURCE, "export const value = 2\n")
    commitAll(dir, "change source")

    // when
    const result = runGate(dir)

    // then
    expect(result.exitCode).toBe(0)
  })

  test.each([
    { name: "a release-state PR from this repository", release: "1", expected: 0 },
    { name: "the same marker from a fork", release: "0", expected: 1 },
  ])(
    "#given $name that commits a listed bundle #when the gate runs #then the exit code is $expected",
    ({ release, expected }) => {
      // given
      const dir = fixtureRepository()
      put(dir, LISTED, "bundle v2\n")
      commitAll(dir, "release: v5.1.70")

      // when
      const result = runGate(dir, { release, ...RELEASE_STATE })

      // then
      expect(result.exitCode).toBe(expected)
    },
  )
})
