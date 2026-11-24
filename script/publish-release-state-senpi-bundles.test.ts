/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { runBlock } from "./release-workflow-test-steps"

const repoRoot = join(import.meta.dir, "..")
const workflow = readFileSync(join(repoRoot, ".github", "workflows", "publish.yml"), "utf8")
const prepareStep = runBlock(
  workflow,
  "      - name: Prepare release state (generation)\n",
  "      - name: Publish prepared release state\n",
)
const commands = prepareStep
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"))

// Release contract (#14867): the committed bundles read the version from the manifests at runtime, so the release
// stamp rebuilds none of them and stages none of their directories; open bundle pull requests survive a release.
describe("release-state generation and the committed bundles", () => {
  test.each([
    ["the Senpi extension build", /packages\/omo-senpi\/plugin\/scripts\/build-extension\.mjs/],
    ["the Codex installer build", /build:codex-install|script\/build-codex-install\.ts/],
    ["the service-auth build", /script\/build-service-auth\.ts/],
  ])("does not run %s", (_name, generator) => {
    expect(commands.filter((line) => generator.test(line))).toEqual([])
  })

  test("stages no generated bundle directory", () => {
    const bundleDirs =
      /packages\/omo-senpi\/plugin\/(extensions|runtime)|omo-codex\/scripts\/install-dist|omo-native\/bin\/lib/
    expect(commands.filter((line) => /^git add\b/.test(line) && bundleDirs.test(line))).toEqual([])
  })
})
