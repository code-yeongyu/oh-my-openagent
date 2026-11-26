import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { deriveBundleGuards } from "./bundle-guards"

const cli = fileURLToPath(new URL("./bundle-guards.ts", import.meta.url))
const bundlePath = "packages/omo-senpi/plugin/extensions/omo.js"
const sourcePath = "packages/omo-senpi/src/marker.ts"

const bundleCarriesSourceMarkerGuard = `import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"

test("the shipped bundle carries the source marker", () => {
  const marker = readFileSync("${sourcePath}", "utf8").trim()
  expect(readFileSync("${bundlePath}", "utf8")).toContain(marker)
})
`

const fixtures: string[] = []

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-c", "core.hooksPath=/dev/null", ...args], { cwd, stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`)
  return result.stdout.toString().trim()
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), body)
  }
}

function commit(root: string, files: Record<string, string>, message: string): string {
  writeFiles(root, files)
  git(root, "add", "-A")
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "commit", "-q", "-m", message)
  return git(root, "rev-parse", "HEAD")
}

function fixtureRepo(extra: Record<string, string> = {}): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), "bundle-guards-"))
  fixtures.push(root)
  git(root, "init", "-q", "-b", "dev")
  const base = commit(
    root,
    {
      "packages/omo-senpi/bundle-inputs.json": JSON.stringify({ version: 1, files: [sourcePath] }),
      [sourcePath]: "marker-1\n",
      [bundlePath]: "// bundle\nconst marker = 'marker-1'\n",
      "script/omo-bundle-fresh.test.ts": bundleCarriesSourceMarkerGuard,
      "docs/readme.md": "docs\n",
      ...extra,
    },
    "base",
  )
  return { root, base }
}

function runGate(root: string, base: string, ...args: string[]): { exitCode: number; output: string } {
  const result = Bun.spawnSync([process.execPath, cli, "--base", base, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  })
  return { exitCode: result.exitCode, output: `${result.stdout.toString()}${result.stderr.toString()}` }
}

describe("bundle guard push gate (#15072)", () => {
  test("#given a push that regenerates the bundle and breaks a guard that reads it #when the gate runs #then it refuses and names the failing test", () => {
    // given
    const { root, base } = fixtureRepo()
    commit(root, { [bundlePath]: "// regenerated without the marker\n" }, "regenerate")

    // when
    const { exitCode, output } = runGate(root, base)

    // then
    expect(exitCode).toBe(1)
    expect(output).toContain("BUNDLE_GUARDS_FAILED")
    expect(output).toContain("script/omo-bundle-fresh.test.ts")
    expect(output).toContain("the shipped bundle carries the source marker")
  })

  test("#given a push that changes a bundle input without regenerating #when the gate runs #then the guard that reads the bundle refuses it", () => {
    // given
    const { root, base } = fixtureRepo()
    commit(root, { [sourcePath]: "marker-2\n" }, "change a bundled source")

    // when
    const { exitCode, output } = runGate(root, base)

    // then
    expect(exitCode).toBe(1)
    expect(output).toContain("BUNDLE_GUARDS_FAILED")
    expect(output).toContain("script/omo-bundle-fresh.test.ts")
  })

  test("#given a bundle push that keeps every guard green #when the gate runs #then it passes", () => {
    // given
    const { root, base } = fixtureRepo()
    commit(root, { [sourcePath]: "marker-2\n", [bundlePath]: "const marker = 'marker-2'\n" }, "change and regenerate")

    // when
    const { exitCode, output } = runGate(root, base)

    // then
    expect(exitCode).toBe(0)
    expect(output).toContain("BUNDLE_GUARDS_OK")
  })

  test("#given a push that touches neither a bundle input nor a generated path #when the gate runs #then it does not run the guards", () => {
    // given
    const { root, base } = fixtureRepo()
    commit(root, { [bundlePath]: "// already stale\n" }, "stale bundle on the base")
    const staleBase = git(root, "rev-parse", "HEAD")
    commit(root, { "docs/readme.md": "more docs\n" }, "docs only")

    // when
    const { exitCode, output } = runGate(root, staleBase)

    // then
    expect(exitCode).toBe(0)
    expect(output).toContain("BUNDLE_GUARDS_NOT_APPLICABLE")
  })

  test("#given a tracked file that differs from the pushed head #when the gate runs #then it refuses instead of testing other bytes", () => {
    // given
    const { root, base } = fixtureRepo()
    commit(root, { [sourcePath]: "marker-2\n", [bundlePath]: "const marker = 'marker-2'\n" }, "change and regenerate")
    writeFiles(root, { [bundlePath]: "// rebuilt by a local install\n" })

    // when
    const { exitCode, output } = runGate(root, base)

    // then
    expect(exitCode).toBe(1)
    expect(output).toContain("BUNDLE_GUARDS_DIRTY_TREE")
    expect(output).toContain(bundlePath)
  })

  test("#given a new script test that reads a bundle path #when the set is derived #then it joins without a list edit, and a test that reads none stays out", () => {
    // given
    const { root } = fixtureRepo({
      "script/new-runtime-guard.test.ts": `const path = "packages/omo-senpi/plugin/runtime/thread-sdk/sdk.js"\n`,
      "script/nested/installer-guard.test.ts": `const path = "packages/omo-codex/scripts/install-dist/install-local.mjs"\n`,
      "script/unrelated.test.ts": `const path = "packages/omo-senpi/src/index.ts"\n`,
      "script/fixtures/fake.test.ts": `const path = "packages/omo-senpi/plugin/extensions/omo.js"\n`,
    })

    // when
    const guards = deriveBundleGuards(root)

    // then
    expect(guards).toEqual([
      "script/nested/installer-guard.test.ts",
      "script/new-runtime-guard.test.ts",
      "script/omo-bundle-fresh.test.ts",
    ])
  })
})
