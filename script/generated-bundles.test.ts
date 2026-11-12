import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { isGeneratedBundlePath, loadGeneratedBundlePatterns } from "./generated-bundles.ts"

// The check that every output the full build writes is listed and ignored builds the plugin, so it runs with the Senpi
// suite after the build: packages/omo-senpi/plugin/scripts/generated-bundles-list.test.mjs.
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
    { path: "packages/omo-senpi/plugin/scripts/install.mjs", listed: true },
    { path: "packages/omo-senpi/plugin/scripts/build-install.mjs", listed: false },
    { path: "packages/omo-native/bin/lib/reflection-lock.generated.js", listed: true },
    { path: "packages/omo-native/bin/lib/brand-logo.generated.js", listed: true },
    { path: "packages/omo-native/bin/lib/brand-logo.generated.d.ts", listed: false },
  ])("#given the ECMAScript patterns #when $path is matched #then listed is $listed", ({ path, listed }) => {
    // given
    const patterns = loadGeneratedBundlePatterns()

    // when
    const matched = isGeneratedBundlePath(path, patterns)

    // then
    expect(matched).toBe(listed)
  })

  // Replaces the PR gate (#13192): the listed outputs are build outputs, never tracked, so a PR that adds one back fails.
  test("#given the list #when matched against the tracked files #then no tracked file is a listed output", () => {
    // given
    const tracked = trackedFiles()
    const patterns = loadGeneratedBundlePatterns()

    // when
    const trackedOutputs = tracked.filter((path) => isGeneratedBundlePath(path, patterns))

    // then
    expect(tracked.length).toBeGreaterThan(0)
    expect(trackedOutputs).toEqual([])
  })
})
