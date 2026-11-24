import { afterAll, beforeAll, expect, test } from "bun:test"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const verifier = fileURLToPath(new URL("./verify-release-stamp-tree.mjs", import.meta.url))
const repo = mkdtempSync(join(tmpdir(), "exact-release-tree-"))
const home = mkdtempSync(join(tmpdir(), "exact-release-home-"))
const env = { ...process.env, HOME: home, GIT_CONFIG_NOSYSTEM: "1" }
const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim()
const write = (name: string, text: string) => {
  const path = join(repo, name)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}
const extension = "packages/omo-senpi/plugin/extensions/demo.js"
const fragment = "changes/unreleased/1.md"
const adapters = [
  "packages/omo-senpi/package.json",
  "packages/omo-senpi/plugin/package.json",
  "packages/omo-codex/package.json",
  "packages/omo-codex/plugin/package.json",
  "packages/omo-codex/plugin/.codex-plugin/plugin.json",
  "packages/oh-my-opencode-linux-x64/package.json",
  "packages/omo-codex/plugin/components/demo/package.json",
]
const packageJson = (version: string) =>
  JSON.stringify({
    name: "proof-fixture",
    version,
    scripts: { "bundle-inputs:check": "true", "brand-logo:check": "true" },
  })
// The fixture generator writes version-independent bytes, as the real ones do since #14867; `legacyPin` is a pin
// from before that, whose generator still writes the version into the bundle.
const builder = (embedsVersion: boolean) =>
  `import fs from 'node:fs';
    const v=${embedsVersion ? "JSON.parse(fs.readFileSync('package.json')).version" : "'built'"};
    if(process.argv.includes('--check')) {if(fs.readFileSync('${extension}','utf8')!==v) process.exit(1)}
    else fs.writeFileSync('${extension}',v);`
let pin: string
let legacyPin: string
beforeAll(() => {
  git("init", "-q")
  git("config", "user.name", "Fixture")
  git("config", "user.email", "test@example.invalid")
  write("package.json", packageJson("1.0.0"))
  write("packages/omo-native/package.json", '{"version":"1.0.0"}')
  for (const path of adapters) write(path, '{"version":"1.0.0"}')
  write("CHANGELOG.md", "original\n")
  write(fragment, "expected release entry\n")
  write(
    "script/stamp-release-changelog.ts",
    `import {readFileSync,writeFileSync,unlinkSync} from 'node:fs';
    writeFileSync('CHANGELOG.md',readFileSync('${fragment}')); unlinkSync('${fragment}');`,
  )
  write(extension, "built")
  write("packages/omo-senpi/plugin/scripts/build-extension.mjs", builder(false))
  write("script/build-service-auth.ts", "export {}")
  write("script/build-codex-install.ts", "export {}")
  write("packages/omo-senpi/plugin/scripts/build-install.mjs", "export {}")
  write(
    "script/codex-install-bundle-freshness.test.ts",
    `import {test,expect} from 'bun:test';test('fixture installed',()=>expect(Bun.file('package.json').size).toBeGreaterThan(0))`,
  )
  execFileSync("bun", ["install", "--ignore-scripts"], { cwd: repo, env })
  git("add", "-A")
  git("commit", "-qm", "pin")
  pin = git("rev-parse", "HEAD")
  write(extension, "1.0.0")
  write("packages/omo-senpi/plugin/scripts/build-extension.mjs", builder(true))
  git("add", "-A")
  git("commit", "-qm", "legacy pin")
  legacyPin = git("rev-parse", "HEAD")
})
afterAll(() => {
  rmSync(repo, { force: true, recursive: true })
  rmSync(home, { force: true, recursive: true })
})

test.each([
  "valid",
  "legacy-pin",
  "partial-version",
  "unchanged-platform",
  "forged-runtime",
  "extra-runtime",
  "edited-notes",
  "retained-fragment",
  "extra-source",
] as const)("the exact stamp tree is verified for %s", (variant) => {
  const base = variant === "legacy-pin" ? legacyPin : pin
  git("checkout", "-q", "--detach", "--force", base)
  git("clean", "-fdq")
  write("package.json", packageJson("1.0.1"))
  if (variant !== "partial-version") {
    write("packages/omo-native/package.json", '{"version":"1.0.1"}')
    for (const path of adapters) {
      if (variant !== "unchanged-platform" || !path.includes("oh-my-opencode-linux")) write(path, '{"version":"1.0.1"}')
    }
  }
  if (variant === "forged-runtime") write(extension, "stale")
  write("CHANGELOG.md", variant === "edited-notes" ? "unexpected\n" : "expected release entry\n")
  if (variant !== "retained-fragment") rmSync(join(repo, fragment))
  if (variant === "extra-runtime") write("packages/omo-senpi/plugin/extensions/unbuilt.js", "not built")
  if (variant === "extra-source") write("src/unrelated.ts", "export {}")
  git("add", "-A")
  git("commit", "-qm", variant)
  const result = spawnSync("node", [verifier, base, git("rev-parse", "HEAD"), "1.0.1", "1.0.1"], {
    cwd: repo,
    env,
    encoding: "utf8",
  })
  expect(result.status, result.stderr).toBe(variant === "valid" ? 0 : 1)
  if (variant === "edited-notes" || variant === "retained-fragment")
    expect(result.stderr).toContain("release notes differ")
  if (variant === "forged-runtime") expect(result.stderr).toContain(`${extension}: outside RELEASE_STATE_PATHS`)
  if (variant === "extra-runtime")
    expect(result.stderr).toContain("packages/omo-senpi/plugin/extensions/unbuilt.js: outside RELEASE_STATE_PATHS")
  if (variant === "legacy-pin") expect(result.stderr).toContain(`generated bytes differ from stamp: ${extension}`)
  if (variant === "extra-source") expect(result.stderr).toContain("outside RELEASE_STATE_PATHS")
  if (variant === "partial-version") {
    expect(result.stderr).toContain("packages/omo-native/package.json: expected release version 1.0.1")
    expect(result.stderr).toContain("packages/omo-senpi/package.json: expected release version 1.0.1")
  }
  if (variant === "unchanged-platform")
    expect(result.stderr).toContain("packages/oh-my-opencode-linux-x64/package.json: expected release version")
})

test("both parent dispatch and direct child tagging require successful exact-stamp verification for a pin", () => {
  const { jobs } = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8"),
  ) as {
    jobs: Record<string, { needs: string[]; if: string; permissions: Record<string, string> }>
  }
  for (const key of ["dispatch-provenance-safe-publish", "tag-prepared-source"]) {
    expect(jobs[key]?.needs).toContain("verify-exact-pinned-stamp")
    expect(jobs[key]?.if).toContain("needs.verify-exact-pinned-stamp.result == 'success'")
    expect(jobs[key]?.if).toContain("inputs.source_sha == '' && needs.verify-exact-pinned-stamp.result == 'skipped'")
  }
  expect(jobs["verify-exact-pinned-stamp"]?.permissions).toEqual({ contents: "read" })
})

test("release metadata is authoritative even when the stamp requests independent CI", () => {
  const workflow = Bun.YAML.parse(
    readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8"),
  ) as {
    jobs: Record<string, { needs: string[]; steps: { id?: string; env?: Record<string, string>; run?: string }[] }>
  }
  const job = workflow.jobs["verify-exact-pinned-stamp"]
  expect(job?.needs).toContain("release-metadata")
  const step = job?.steps.find((entry) => entry.id === "verify")
  expect(step?.env?.VERSION).toBe("${{ needs.release-metadata.outputs.version }}")
  expect(step?.env?.NATIVE_VERSION).toBe("${{ needs.release-metadata.outputs.omo_ai_version }}")
  const run = step?.run ?? ""
  const versions = run.indexOf('--check-versions "$PIN" "$STAMP" "$VERSION" "$NATIVE_VERSION"')
  expect(versions).toBeGreaterThan(-1)
  expect(versions).toBeLessThan(run.indexOf("independent_ci_required=true"))
})
