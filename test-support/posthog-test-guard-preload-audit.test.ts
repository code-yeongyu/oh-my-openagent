import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

// Architecture contract (#10394): every Bun test runner in the repo installs the PostHog test guard,
// either through the shared guard preload or through the root test-setup.ts that installs it. The
// runners are derived from the repo, not from a list: every bunfig with a [test] section, and every
// package.json under packages/ whose scripts run `bun test` (Bun reads only the bunfig in the
// directory it runs from, so a root-workspace package needs its own guarded bunfig). A package outside
// the root workspace installs its own dependencies, so it cannot load the guard: it runs bun test only
// when it is named in NON_WORKSPACE_TEST_RUNNERS, and no package outside the root workspace may depend
// on PostHog.
const repoRoot = resolve(import.meta.dir, "..")
const guardPreloadFiles = ["test-support/posthog-test-guard.preload.ts", "test-setup.ts"]
const NON_WORKSPACE_TEST_RUNNERS = [
  // own bun.lock and CI install
  "packages/web",
  "packages/get-worker",
  // Codex plugin bundle: installed by the plugin's own npm install and shipped to users
  "packages/omo-codex/plugin/components/bootstrap",
  "packages/omo-codex/plugin/components/git-bash",
  "packages/omo-codex/plugin/components/teammode",
  "packages/omo-codex/plugin/shared",
]

type PackageJson = {
  scripts?: Record<string, string>
  workspaces?: string[]
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function listFiles(repoRoot: string, pattern: string): string[] {
  const listed = spawnSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", pattern], { cwd: repoRoot, encoding: "utf8" })
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  return listed.stdout.split("\n").filter((path) => path.length > 0)
}

function readJson(repoRoot: string, path: string): PackageJson {
  return JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as PackageJson
}

function testPreloads(repoRoot: string, bunfigPath: string): string[] | undefined {
  const parsed: { test?: { preload?: string | string[] } } = Bun.TOML.parse(readFileSync(join(repoRoot, bunfigPath), "utf8"))
  if (parsed.test === undefined) return undefined
  const preload = parsed.test.preload ?? []
  return (Array.isArray(preload) ? preload : [preload]).map((entry) => resolve(repoRoot, dirname(bunfigPath), entry))
}

function isGuarded(repoRoot: string, bunfigPath: string): boolean {
  const guardPreloads = new Set(guardPreloadFiles.map((file) => join(repoRoot, file)))
  return (testPreloads(repoRoot, bunfigPath) ?? []).some((preload) => guardPreloads.has(preload))
}

function runsBunTest(manifest: PackageJson): boolean {
  return Object.values(manifest.scripts ?? {}).some((script) => /\bbun\s+test\b/.test(script))
}

function dependsOnPostHog(repoRoot: string, packageDir: string, manifest: PackageJson): boolean {
  const declared = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies, manifest.peerDependencies].flatMap((deps) => Object.keys(deps ?? {}))
  if (declared.some((name) => name.startsWith("posthog"))) return true
  const lockfile = join(repoRoot, packageDir, "bun.lock")
  return existsSync(lockfile) && /"posthog[-\w]*"/.test(readFileSync(lockfile, "utf8"))
}

function findUnguardedTestRunners(): string[] {
  const unguarded = listFiles(repoRoot, "*bunfig*.toml").filter((path) => testPreloads(repoRoot, path) !== undefined && !isGuarded(repoRoot, path))
  const workspaces = new Set(readJson(repoRoot, "package.json").workspaces ?? [])
  const unusedAllowlist = new Set(NON_WORKSPACE_TEST_RUNNERS)
  for (const manifestPath of listFiles(repoRoot, "packages/**/package.json")) {
    const packageDir = dirname(manifestPath)
    const manifest = readJson(repoRoot, manifestPath)
    if (!workspaces.has(packageDir)) {
      if (dependsOnPostHog(repoRoot, packageDir, manifest)) unguarded.push(`${packageDir} (outside the root workspace and depends on PostHog)`)
      if (!runsBunTest(manifest)) continue
      if (unusedAllowlist.delete(packageDir)) continue
      unguarded.push(`${packageDir} (runs bun test outside the root workspace and is not in NON_WORKSPACE_TEST_RUNNERS)`)
      continue
    }
    if (!runsBunTest(manifest)) continue
    const bunfig = `${packageDir}/bunfig.toml`
    if (!existsSync(join(repoRoot, bunfig)) || !isGuarded(repoRoot, bunfig)) unguarded.push(`${packageDir} (runs bun test without a bunfig.toml that preloads the guard)`)
  }
  for (const packageDir of unusedAllowlist) unguarded.push(`${packageDir} (in NON_WORKSPACE_TEST_RUNNERS but no package.json there runs bun test)`)
  return [...new Set(unguarded)].sort()
}

describe("PostHog test guard preload audit (#10394)", () => {
  test("#given every bun test runner derived from the repo #when its preloads are resolved #then each one installs the PostHog test guard", () => {
    // given
    const configs = listFiles(repoRoot, "*bunfig*.toml")

    // when
    const unguarded = findUnguardedTestRunners()

    // then
    expect(unguarded).toEqual([])
    expect(configs).toEqual(expect.arrayContaining(["bunfig.toml", "packages/omo-senpi/bunfig.toml", "packages/senpi-task/bunfig.toml", "packages/telemetry-core/bunfig.toml"]))
  })
})
