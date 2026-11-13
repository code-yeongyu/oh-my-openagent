import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { isGeneratedBundlePath, loadGeneratedBundlePatterns, RELEASE_GENERATORS } from "./generated-bundles.ts"

// The two-way check (the list equals what the release generators write) builds the plugin, so it runs with the
// Senpi suite after the build: packages/omo-senpi/plugin/scripts/generated-bundles-list.test.mjs.
const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const RUNTIME = "packages/omo-senpi/plugin/runtime"

function trackedFiles(): readonly string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: repositoryRoot })
  if (result.exitCode !== 0) throw new Error(`git ls-files failed: ${result.stderr.toString()}`)
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path.length > 0)
}

describe("generated bundle list", () => {
  test.each([
    { path: `${RUNTIME}/thread-sdk/sdk.js`, listed: true },
    { path: `${RUNTIME}/rollback-migrate.js`, listed: true },
    { path: `${RUNTIME}/dag/sdk.js`, listed: false },
    { path: `${RUNTIME}/dag/library.js`, listed: false },
    { path: `${RUNTIME}/bunshin-ts-old/sdk.js`, listed: false },
    { path: `${RUNTIME}/thread-sdk/x/sdk.js`, listed: false },
  ])("#given the ECMAScript patterns #when $path is matched #then listed is $listed", ({ path, listed }) => {
    // given
    const patterns = loadGeneratedBundlePatterns()

    // when
    const matched = isGeneratedBundlePath(path, patterns)

    // then
    expect(matched).toBe(listed)
  })

  test("#given the list #when each pattern is matched against the tracked files #then every pattern matches one", () => {
    // given
    const tracked = trackedFiles()
    const patterns = loadGeneratedBundlePatterns()

    // when
    const dead = patterns.filter((pattern) => !tracked.some((path) => pattern.test(path))).map(String)

    // then
    expect(patterns.length).toBeGreaterThan(0)
    expect(dead).toEqual([])
  })

  test("#given the omo-ai payload job #when its steps are read #then it builds the generated outputs before packing omo-native", () => {
    // given
    const workflow = Bun.YAML.parse(readFileSync(`${repositoryRoot}.github/workflows/ci.yml`, "utf8")) as {
      jobs: Record<string, { steps: { run?: string }[] }>
    }
    const steps = workflow.jobs["omo-ai-payload-check"]?.steps ?? []

    // when
    const buildGenerated = steps.findIndex((step) => step.run?.includes("bun script/build-generated.ts") ?? false)
    const buildNative = steps.findIndex((step) => step.run?.includes("build:omo-native") ?? false)

    // then
    expect(buildNative).toBeGreaterThan(-1)
    expect(buildGenerated).toBeGreaterThan(-1)
    expect(buildGenerated).toBeLessThan(buildNative)
  })

  // Pinned against what the release workflow runs: each generator in RELEASE_GENERATORS is invoked by publish.yml
  // directly, through its package.json script, or through script/build-generated.ts, which runs the whole table.
  test("#given the release generator table #when compared with publish.yml #then the release workflow runs every generator in it", () => {
    // given
    const publish = readFileSync(`${repositoryRoot}.github/workflows/publish.yml`, "utf8")
    const scripts: Record<string, string> = JSON.parse(readFileSync(`${repositoryRoot}package.json`, "utf8")).scripts

    // when
    const notRun = RELEASE_GENERATORS.filter((generator) => {
      if (publish.includes("script/build-generated.ts") || publish.includes(generator.script)) return false
      return !Object.entries(scripts).some(
        ([name, command]) => command.includes(generator.script) && publish.includes(`bun run ${name}`),
      )
    }).map((generator) => generator.script)
    const missing = RELEASE_GENERATORS.filter((generator) => !existsSync(`${repositoryRoot}${generator.script}`))

    // then
    expect(RELEASE_GENERATORS.length).toBeGreaterThan(0)
    expect({ notRun, missing }).toEqual({ notRun: [], missing: [] })
  })
})
