import { describe, expect, test } from "bun:test"
import { fileURLToPath } from "node:url"

import { checkGeneratedBundles, isGeneratedBundle } from "./generated-bundles"

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url))
const POLICY = { releaseBranchPattern: /^release\//, releaseActors: ["sisyphus-dev-ai"] }

function trackedFiles(...paths: string[]): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "--", ...paths], { cwd: repositoryRoot })
  return result.stdout.toString().split("\n").filter(Boolean)
}

describe("the generated-bundle list", () => {
  test("#given every tracked plugin bundle and installer #when classified #then each is generated", () => {
    // given
    const bundles = [
      ...trackedFiles("packages/omo-senpi/plugin/extensions").filter((path) => /\.m?js$|assets\.generated\.json$/.test(path)),
      ...trackedFiles(
        "packages/omo-senpi/plugin/runtime/agent-toolkit-sdk",
        "packages/omo-senpi/plugin/runtime/dag",
        "packages/omo-senpi/plugin/runtime/thread-sdk",
        "packages/omo-senpi/plugin/runtime/rollback-migrate.js",
        "packages/omo-senpi/plugin/scripts/install.mjs",
        "packages/omo-codex/scripts/install-dist/install-local.mjs",
      ),
    ]

    // then
    expect(bundles.length).toBeGreaterThan(20)
    expect(bundles.filter((path) => !isGeneratedBundle(path))).toEqual([])
  })

  test("#given hand-edited plugin files and sources #when classified #then none is generated", () => {
    // given
    const handEdited = [
      ...trackedFiles("packages/omo-senpi/plugin/extensions").filter((path) => !/\.m?js$|assets\.generated\.json$/.test(path)),
      "packages/omo-senpi/plugin/scripts/build-extension.mjs",
      "packages/omo-senpi/src/extension/index.ts",
      "packages/omo-codex/scripts/install-local.mjs",
    ]

    // then
    expect(handEdited.some((path) => path.endsWith(".wasm"))).toBe(true)
    expect(handEdited.filter(isGeneratedBundle)).toEqual([])
  })
})

describe("the PR rule", () => {
  test("#given a feature PR that commits a bundle #when checked #then it fails and names the path", () => {
    // when
    const result = checkGeneratedBundles(
      { changedFiles: ["packages/omo-senpi/src/a.ts", "packages/omo-senpi/plugin/extensions/omo.js"], branch: "feat/x", author: "someone" },
      POLICY,
    )

    // then
    expect(result.pass).toBe(false)
    expect(result.reason).toContain("packages/omo-senpi/plugin/extensions/omo.js")
  })

  test("#given a source-only PR #when checked #then it passes", () => {
    expect(checkGeneratedBundles({ changedFiles: ["packages/omo-senpi/src/a.ts"], branch: "feat/x", author: "someone" }, POLICY).pass).toBe(true)
  })

  test("#given the release-state PR #when it carries bundles #then it passes, and only with both branch and author", () => {
    // given
    const changedFiles = ["packages/omo-senpi/plugin/extensions/omo.js"]

    // then
    expect(checkGeneratedBundles({ changedFiles, branch: "release/v5.1.40-source-state", author: "sisyphus-dev-ai" }, POLICY).pass).toBe(true)
    expect(checkGeneratedBundles({ changedFiles, branch: "release/v5.1.40-source-state", author: "someone" }, POLICY).pass).toBe(false)
    expect(checkGeneratedBundles({ changedFiles, branch: "feat/x", author: "sisyphus-dev-ai" }, POLICY).pass).toBe(false)
  })
})
