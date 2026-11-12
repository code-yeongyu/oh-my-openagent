import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { isGeneratedBundlePath, loadGeneratedBundlePatterns } from "./generated-bundles.ts"

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
})
