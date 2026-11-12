/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { jobSteps, publishWorkflow, readWorkflow, stepAt } from "./keychain-helper-workflow.test-support"

// Release and CI contract (#13192): generated outputs are not tracked, so a job that installs with --ignore-scripts and
// then bundles, tests or runs code that imports one of them must build them first, under the same condition.
const BUILD_GENERATED = "bun script/build-generated.ts"
const ciWorkflow = readWorkflow("ci.yml")

describe("the release job builds the generated files before the LazyCodex marketplace sync bundles the CLI", () => {
  const steps = jobSteps(publishWorkflow, "release")

  test("right before the sync, under its condition", () => {
    const generate = stepAt(steps, "Build generated files")
    const sync = stepAt(steps, "Sync LazyCodex Codex marketplace")
    expect(generate.index).toBe(sync.index - 1)
    expect(generate.value.if).toBe(sync.value.if)
    expect(generate.value.run?.trim()).toBe(BUILD_GENERATED)
  })
})

describe("the release build preflight runs the release job's CLI bundles before anything is published", () => {
  const runs = jobSteps(publishWorkflow, "release-build-preflight").flatMap((step) =>
    (step.run ?? "").split("\n").map((line) => line.trim()),
  )

  test("both CLI builds, after the generated files are built", () => {
    const generated = runs.indexOf(BUILD_GENERATED)
    const cli = runs.indexOf(
      'bun build packages/omo-opencode/src/cli/index.ts --outdir "$RUNNER_TEMP/preflight-cli" --target bun --format esm',
    )
    const cliNode = runs.indexOf("bun run build:cli-node")
    expect(generated).toBeGreaterThanOrEqual(0)
    expect(cli).toBeGreaterThan(generated)
    expect(cliNode).toBeGreaterThan(generated)
  })
})

describe("codex-compatibility builds the generated files after its --ignore-scripts install", () => {
  const steps = jobSteps(ciWorkflow, "codex-compatibility")

  test("before the full suite and the platform smoke legs, under the install's condition", () => {
    const install = stepAt(steps, "Install dependencies")
    const generate = stepAt(steps, "Build generated files")
    expect(generate.index).toBe(install.index + 1)
    expect(generate.value.if).toBe(install.value.if)
    expect(generate.value.run?.trim()).toBe(BUILD_GENERATED)
    for (const reader of ["Run full Codex compatibility suite", "Build Codex platform smoke prerequisites"])
      expect(stepAt(steps, reader).index).toBeGreaterThan(generate.index)
  })
})

// Every job the static reader inventory (#13192) found reading an untracked output on its own tree, with the step that builds it first and the
// steps that read it. A job loses its guard when the builder disappears, moves after a reader, or its install gains --ignore-scripts.
const BUILDS = /bun script\/build-generated\.ts|\bbun run build\b(?![:\w-])|bun install(?![^\n]*--ignore-scripts)/
const READERS: ReadonlyArray<readonly [workflow: string, job: string, builder: string, readers: readonly string[]]> = [
  ["ci.yml", "test", "Install dependencies", ["Run tests"]],
  [
    "ci.yml",
    "macos-combined",
    "Install dependencies",
    ["Run root test shard 1", "Run root test shard 2", "Run Codex platform smoke", "Run Senpi compatibility tests"],
  ],
  [
    "ci.yml",
    "codex-compatibility",
    "Build generated files",
    ["Run full Codex compatibility suite", "Build Codex platform smoke prerequisites"],
  ],
  [
    "ci.yml",
    "senpi-compatibility",
    "Verify generated outputs and committed Senpi files are current",
    ["Run Senpi compatibility tests"],
  ],
  ["ci.yml", "omo-ai-payload-check", "Install dependencies", ["Build omo-native"]],
  [
    "ci.yml",
    "native-binary-parity",
    "Install dependencies",
    ["Build the standalone binary and the npm launcher payload"],
  ],
  ["publish-platform.yml", "build", "Build generated files", ["Build release binary"]],
  [
    "publish.yml",
    "release-build-preflight",
    "Build generated files",
    ["Build omo-ai payload", "Build the release job's CLI bundles"],
  ],
  ["publish.yml", "publish-main", "Build generated files", ["Build omo-ai payload"]],
  ["publish.yml", "release", "Build generated files", ["Sync LazyCodex Codex marketplace"]],
  ["web-ci.yml", "format-lint-typecheck-build", "Install dependencies", ["Unit tests"]],
]

describe("every job that reads a generated output builds it first", () => {
  test.each(READERS)("%s %s: %s runs a build before its readers", (workflow, job, builder, readers) => {
    const steps = jobSteps(readWorkflow(workflow), job)
    const build = stepAt(steps, builder)
    expect(build.value.run ?? "").toMatch(BUILDS)
    for (const reader of readers) expect(stepAt(steps, reader).index).toBeGreaterThan(build.index)
  })
})
