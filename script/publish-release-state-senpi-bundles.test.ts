/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, sep } from "node:path"
import { pathToFileURL } from "node:url"

import { jobSteps, platformWorkflow, publishWorkflow, stepAt } from "./keychain-helper-workflow.test-support"
import { runBlock } from "./release-workflow-test-steps"

// Release contract (#13192): generated bundles are not tracked. The release commit carries sources
// only, and every job that packs or compiles from it builds the bundles first.

const repoRoot = join(import.meta.dir, "..")
const buildCore: unknown = await import(
  pathToFileURL(join(repoRoot, "packages/omo-senpi/plugin/scripts/build-extension-core.mjs")).href
)

function bundleOutputs(): string[] {
  if (
    typeof buildCore !== "object" ||
    buildCore === null ||
    !("resolveOutputs" in buildCore) ||
    typeof buildCore.resolveOutputs !== "function"
  ) {
    throw new Error("build-extension-core.mjs no longer exports resolveOutputs")
  }
  const outputs: unknown = buildCore.resolveOutputs({})
  if (typeof outputs !== "object" || outputs === null) throw new Error("resolveOutputs returned no output map")
  return Object.values(outputs)
    .filter((path): path is string => typeof path === "string")
    .map((path) => relative(repoRoot, path).split(sep).join("/"))
}

const GENERATED_OUTPUTS = [
  ...bundleOutputs(),
  "packages/omo-codex/scripts/install-dist/install-local.mjs",
  "packages/omo-native/bin/lib/service-auth.generated.js",
  "packages/omo-native/bin/lib/reflection-lock.generated.js",
  "packages/omo-native/bin/lib/brand-logo.generated.js",
  "packages/omo-senpi/plugin/scripts/install.mjs",
]

const prepareStep = runBlock(
  publishWorkflow,
  "      - name: Prepare release state (generation)\n",
  "      - name: Publish prepared release state\n",
)
const staging = prepareStep.split("\n").filter((line) => /^git add\b/.test(line))

/** One concrete file for each pathspec the staging lines name, so `git add` resolves every one. */
function sourceFixturePaths(): string[] {
  return staging.flatMap((line) =>
    line
      .split(/\s+/)
      .slice(2)
      .filter((token) => !token.startsWith("-"))
      .map((token) => token.replaceAll("*", "fixture"))
      .map((path) => (path.split("/").at(-1)?.includes(".") ? path : `${path}/fixture.md`)),
  )
}

const git = (cwd: string, ...args: string[]) => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`)
  return result.stdout
}

describe("release-state commit", () => {
  test("stages the stamped sources and none of the generated bundles a build left in the tree", () => {
    const sources = sourceFixturePaths()
    const root = mkdtempSync(join(tmpdir(), "omo-release-state-"))
    try {
      git(root, "init", "-q")
      for (const path of [...sources, ...GENERATED_OUTPUTS]) {
        mkdirSync(join(root, dirname(path)), { recursive: true })
        writeFileSync(join(root, path), "built\n")
      }

      const result = spawnSync("bash", ["-e", "-c", staging.join("\n")], { cwd: root, encoding: "utf8" })

      expect(result.status, result.stderr).toBe(0)
      const staged = git(root, "diff", "--cached", "--name-only").trim().split("\n")
      expect(staged.filter((path) => GENERATED_OUTPUTS.includes(path))).toEqual([])
      expect(staged.sort()).toEqual([...new Set(sources)].sort())
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// The generators whose outputs omo-ai and the compiled binary ship, inputs first: the installer bundles the local
// launcher, which imports the brand logo module. The payload gate pins their outputs.
const GENERATORS = [
  "bun script/build-brand-logo.ts",
  "bun script/build-reflection-lock.ts",
  "bun script/build-service-auth.ts",
  "bun run build:codex-install",
  "node packages/omo-senpi/plugin/scripts/build-extension.mjs",
  "node packages/omo-senpi/plugin/scripts/build-install.mjs",
]

function generatorCommands(run: string | undefined): string[] {
  return (run ?? "")
    .split("\n")
    .filter((line) => GENERATORS.includes(line.trim()))
    .map((line) => line.trim())
}

describe("publish-main builds the generated bundles from the release commit", () => {
  const steps = jobSteps(publishWorkflow, "publish-main")

  test("after the version stamp and before the omo-ai payload is built, under the same condition", () => {
    const stamp = stepAt(steps, "Update version")
    const generate = stepAt(steps, "Build generated files")
    const payload = stepAt(steps, "Build omo-ai payload")

    expect(generate.index).toBeGreaterThan(stamp.index)
    expect(generate.index).toBeLessThan(payload.index)
    expect(generate.value.if).toBe(payload.value.if)
    expect(generatorCommands(generate.value.run)).toEqual(GENERATORS)
  })
})

describe("publish-platform builds the generated bundles before compiling the binary", () => {
  const steps = jobSteps(platformWorkflow, "build")

  test("under the binary build's condition", () => {
    const generate = stepAt(steps, "Build generated files")
    const binary = stepAt(steps, "Build release binary")

    expect(generate.index).toBeLessThan(binary.index)
    expect(generate.value.if).toBe(binary.value.if)
    expect(generatorCommands(generate.value.run)).toEqual(GENERATORS)
  })
})
