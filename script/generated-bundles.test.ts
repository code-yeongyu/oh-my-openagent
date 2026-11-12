import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { isGeneratedBundlePath, loadGeneratedBundlePatterns } from "./generated-bundles.ts"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
// Every tracked file below these directories is written by a generator the release job runs (publish.yml), so a
// new output there must join the list or feature PRs could commit it unchecked (#9903).
const GENERATED_DIRECTORIES = [
  "packages/omo-senpi/plugin/extensions/",
  "packages/omo-senpi/plugin/runtime/",
  "packages/omo-codex/scripts/install-dist/",
]

function trackedFiles(): readonly string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z"], { cwd: repositoryRoot })
  if (result.exitCode !== 0) throw new Error(`git ls-files failed: ${result.stderr.toString()}`)
  return result.stdout
    .toString()
    .split("\0")
    .filter((path) => path.length > 0)
}

describe("generated bundle list", () => {
  test("#given tracked files under the generated directories #when matched against the list #then every one is listed", () => {
    // given
    const generated = trackedFiles().filter((path) =>
      GENERATED_DIRECTORIES.some((directory) => path.startsWith(directory)),
    )
    const patterns = loadGeneratedBundlePatterns()

    // when
    const unlisted = generated.filter((path) => !isGeneratedBundlePath(path, patterns))

    // then
    expect(generated.length).toBeGreaterThan(0)
    expect(unlisted).toEqual([])
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
