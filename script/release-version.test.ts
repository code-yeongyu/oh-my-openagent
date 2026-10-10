import { expect, test } from "bun:test"
import { resolveReleaseVersion } from "./release-version.mjs"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

test("the actual metadata step validates before npm reads and forwards channel outputs", () => {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const workflow = Bun.YAML.parse(readFileSync(join(root, ".github/workflows/publish.yml"), "utf8")) as { jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }> }
  const run = workflow.jobs["release-metadata"].steps.find((step) => step.name === "Calculate version")?.run
  if (!run) throw new Error("Missing metadata entrypoint")
  const dir = mkdtempSync(join(tmpdir(), "release-version-"))
  try {
    for (const [version, only, tag, valid] of [
      ["5.0.0-beta.63", "true", "beta", false],
      ["5.0.0-beta.62.lazycodex.1", "false", "beta", false],
      ["5.0.0-beta.62.lazycodex.1", "true", "beta", true],
      ["5.0.0-lazycodex.1", "true", "lazycodex", true],
      ["5.0.0-beta.63", "false", "beta", true],
    ] as const) {
      const output = join(dir, "output")
      const calls = join(dir, "calls")
      writeFileSync(output, "")
      writeFileSync(calls, "")
      const result = spawnSync("bash", ["-e", "-c", `npm() { printf '%s\\n' "$*" >> "$CALLS"; printf '5.0.0-beta.60\\n'; }\n${run}`], {
        cwd: root, encoding: "utf8", timeout: 10_000,
        env: { ...process.env, RAW_VERSION: version, LAZYCODEX_ONLY: only, PUBLISH_LAZYCODEX: "true", GITHUB_OUTPUT: output, CALLS: calls },
      })
      expect(result.status, result.stderr).toBe(valid ? 0 : 1)
      const metadata = readFileSync(output, "utf8")
      if (valid) {
        expect(metadata).toContain(`version=${version}\n`)
        expect(metadata).toContain(`dist_tag=${tag}\n`)
        expect(readFileSync(calls, "utf8")).toBe(`view lazycodex-ai@${tag} version\n`)
      } else {
        expect(metadata).toBe("")
        expect(readFileSync(calls, "utf8")).toBe("")
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test("LazyCodex-only numbers cannot consume the next omo number", () => {
  expect(resolveReleaseVersion("5.0.0-beta.62.lazycodex.1", true)).toEqual({ version: "5.0.0-beta.62.lazycodex.1", distTag: "beta" })
  expect(resolveReleaseVersion("5.0.0-beta.63", false)).toEqual({ version: "5.0.0-beta.63", distTag: "beta" })
  expect(() => resolveReleaseVersion("5.0.0-beta.63", true)).toThrow()
  expect(() => resolveReleaseVersion("5.0.0-beta.62.lazycodex.1", false)).toThrow()
})

test("stable-base LazyCodex releases never advance latest; omo channel mapping stays unchanged", () => {
  expect(resolveReleaseVersion("5.0.0-lazycodex.1", true).distTag).toBe("lazycodex")
  expect(resolveReleaseVersion("5.0.0", false).distTag).toBe("")
  expect(resolveReleaseVersion("5.0.0-rc.2.lazycodex.3", true).distTag).toBe("rc")
})

test("reserved identifier cannot escape the namespace through malformed versions", () => {
  for (const version of ["5.0.0", "5.0.0-beta.1", "5.0.0-beta.1.lazycodex", "5.0.0-beta.1.lazycodex.0", "5.0.0-beta.1.lazycodex.01", "5.0.0-beta.lazycodex.1.extra", "05.0.0-lazycodex.1", "5.0.0-beta.01.lazycodex.1", "5.0.0-latest.lazycodex.1"]) {
    expect(() => resolveReleaseVersion(version, true)).toThrow()
  }
  for (const version of ["5.0.0-lazycodex.1", "5.0.0-beta.lazycodex.1", "5.0.0-lazycodex"]) {
    expect(() => resolveReleaseVersion(version, false)).toThrow()
  }
})
