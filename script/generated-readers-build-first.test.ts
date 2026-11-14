/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

import { load } from "js-yaml"

import { jobSteps, publishWorkflow, readWorkflow, stepAt } from "./keychain-helper-workflow.test-support"
import { moduleGraphStepsBeforeBuild } from "./module-graph-build-order"

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

// Every job of every workflow is classified, so a job added later that reads a generated output without building it
// first cannot pass unnoticed: it is either in READERS above, or listed here with the reason it reads none.
const NO_READER = "the static reader inventory (#13192) found no command in this job that reaches a listed output"
const READS_NOTHING: Readonly<Record<string, string>> = {
  "ci.yml lazycodex-published-smoke":
    "imports install-dist/install-local.mjs from the installed npm package, which ships it",
  "compiled-worker.yml relocated-worker": "copies three source files into a scratch directory and tests only those",
  "desktop-engine.yml native-contract":
    "reaches plugin/scripts/install.mjs only as a path string; passes on an unbuilt tree",
  "computer-live-linux.yml xorg-uinput":
    "runs script/qa/computer/pool/xorg-uinput-probe.ts, whose import closure (6 pool files) reaches only node builtins and bun:ffi",
  "computer-live-windows-full.yml host":
    "runs two PowerShell probes (interactive-desktop-smoke.ps1, hosted-windows-live.ps1); no install step and no JavaScript",
  "computer-live-windows-full.yml ledger":
    "runs script/qa/computer/pool/windows-full.ts with no install, whose import closure (3 pool files) reaches only node:fs",
  "computer-live-windows-full.yml session":
    "runs the hosted-windows-live.ps1 PowerShell probe only; no install step and no JavaScript",
  "get-worker-ci.yml worker":
    "packages/get-worker is its own project (own bun.lock, not a root workspace) and imports no output",
  "bot-merge.yml merge": NO_READER,
  "changelog-gate.yml changelog-gate": NO_READER,
  "ci-full-matrix-label.yml full-matrix": NO_READER,
  "ci.yml lint-ratchet": NO_READER,
  "ci.yml ci-mode": NO_READER,
  "ci.yml block-master-pr": NO_READER,
  "ci.yml macos-test-1-status": NO_READER,
  "ci.yml macos-test-2-status": NO_READER,
  "ci.yml macos-codex-status": NO_READER,
  "ci.yml macos-senpi-status": NO_READER,
  "ci.yml typecheck": NO_READER,
  "ci.yml build": NO_READER,
  "ci.yml auto-commit-schema": NO_READER,
  "ci.yml draft-release": NO_READER,
  "cla.yml cla": NO_READER,
  "cla.yml notice-skipped-signal": NO_READER,
  "computer-engine.yml native-contract": NO_READER,
  "cutover-target-deploy.yml deploy": NO_READER,
  "desktop-linux-qa.yml linux-desktop-qa": NO_READER,
  "desktop-windows-qa.yml windows-desktop-qa": NO_READER,
  "engine-trust-helper.yml windows-helper": NO_READER,
  "get-worker-ci.yml install-unix": NO_READER,
  "get-worker-ci.yml install-alpine": NO_READER,
  "get-worker-ci.yml install-windows": NO_READER,
  "get-worker-deploy.yml deploy": NO_READER,
  "git-job-helper.yml windows-helper": NO_READER,
  "installer-mirror.yml mirror": NO_READER,
  "installer-mirror.yml channel-maintenance": NO_READER,
  "isolation-linux-fs.yml linux-fs": NO_READER,
  "lint-workflows.yml actionlint": NO_READER,
  "linux-trust-containers.yml linux-trust": NO_READER,
  "macos-signing-canary.yml canary": NO_READER,
  "memory-takeover-trace.yml trace": NO_READER,
  "npm-deprecate-version.yml deprecate": NO_READER,
  "npm-dist-tag-rollback.yml retag": NO_READER,
  "package-labels.yml resolve-pr": NO_READER,
  "package-labels.yml ensure-labels": NO_READER,
  "package-labels.yml label-pull-request": NO_READER,
  "package-labels.yml label-issue": NO_READER,
  "package-labels.yml notice-skipped-signal": NO_READER,
  "pr-automation-signal.yml signal": NO_READER,
  "publish-platform.yml desktop-engine": NO_READER,
  "publish-platform.yml keychain-helper": NO_READER,
  "publish-platform.yml publish": NO_READER,
  "publish-platform.yml smoke-linux-arm64": NO_READER,
  "publish.yml gate-reuse": NO_READER,
  "publish.yml preflight-trust": NO_READER,
  "publish.yml release-metadata": NO_READER,
  "publish.yml prepare-release-state": NO_READER,
  "publish.yml dispatch-provenance-safe-publish": NO_READER,
  "publish.yml verify-release-notes": NO_READER,
  "publish.yml publish-platform": NO_READER,
  "publish.yml release-announce": NO_READER,
  "publish.yml release-announce-recovery": NO_READER,
  "publish.yml installer-mirror": NO_READER,
  "publish.yml installer-mirror-beta": NO_READER,
  "publish.yml post-publish-verify": NO_READER,
  "refresh-model-capabilities.yml refresh": NO_READER,
  "release-announce.yml announce": NO_READER,
  "review-claims.yml gate": NO_READER,
  "review-claims.yml reconcile": NO_READER,
  "review-claims.yml stale-sweep": NO_READER,
  "review-claims.yml notice-skipped-signal": NO_READER,
  "sisyphus-agent.yml agent": NO_READER,
  "stats.yml stats": NO_READER,
  "trust-mutations.yml mutations": NO_READER,
  "web-ci.yml e2e": NO_READER,
  "web-deploy.yml deploy": NO_READER,
  "windows-flake-soak.yml soak": NO_READER,
}

describe("every workflow job is classified as a generated-output reader or not", () => {
  const workflowsDir = new URL("../.github/workflows/", import.meta.url)
  const jobs = readdirSync(workflowsDir)
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => {
      const parsed = load(readWorkflow(name))
      const jobNames =
        parsed !== null && typeof parsed === "object" && "jobs" in parsed ? Object.keys(Object(parsed.jobs)) : []
      return jobNames.map((job) => `${name} ${job}`)
    })
  const readers = new Set(READERS.map(([workflow, job]) => `${workflow} ${job}`))

  test("no job is unclassified", () => {
    expect(jobs.filter((job) => !readers.has(job) && READS_NOTHING[job] === undefined)).toEqual([])
  })

  test("no classification names a job that no longer exists", () => {
    const existing = new Set(jobs)
    expect([...readers, ...Object.keys(READS_NOTHING)].filter((job) => !existing.has(job))).toEqual([])
  })
})

describe("in every job, a step that resolves the module graph of repository code comes after a build step", () => {
  test("today's workflows", () => {
    expect(
      moduleGraphStepsBeforeBuild(fileURLToPath(new URL("../.github/workflows/", import.meta.url)), BUILDS),
    ).toEqual([])
  })

  test("a test step added to a job that builds nothing is reported with its job and step", () => {
    const root = mkdtempSync(join(tmpdir(), "module-graph-build-order-"))
    try {
      mkdirSync(join(root, "workflows"))
      const steps = (first: string) =>
        `jobs:\n  probe:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Install dependencies\n        run: ${first}\n      - name: Probe\n        run: bun test script/no-raw-tls-client.test.ts\n`
      writeFileSync(join(root, "workflows", "unbuilt.yml"), steps("bun install --frozen-lockfile --ignore-scripts"))
      writeFileSync(join(root, "workflows", "built.yml"), steps("bun install --frozen-lockfile"))
      expect(moduleGraphStepsBeforeBuild(join(root, "workflows"), BUILDS)).toEqual([
        { job: "unbuilt.yml probe", step: "Probe", command: "bun test script/no-raw-tls-client.test.ts" },
      ])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

// Generated outputs are built with node scripts (build-extension.mjs and the other .mjs generators), and the bytes depend
// on the node major, so every job that builds them pins node before the build at the major the release preflight proves.
describe("every job that builds the generated outputs pins node first, at the release preflight's major", () => {
  const nodeMajor = (step: { readonly uses?: string; readonly with?: Record<string, unknown> }): string | undefined =>
    typeof step.uses === "string" && step.uses.startsWith("actions/setup-node")
      ? String(step.with?.["node-version"] ?? "").split(".")[0]
      : undefined
  const preflightSteps = jobSteps(publishWorkflow, "release-build-preflight")
  const preflightMajor = preflightSteps.map(nodeMajor).find((major) => major !== undefined)

  type RawStep = { readonly run?: unknown; readonly uses?: string; readonly with?: Record<string, unknown> } & Record<
    string,
    unknown
  >
  const builders = readdirSync(new URL("../.github/workflows/", import.meta.url))
    .filter((name) => /\.ya?ml$/.test(name))
    .flatMap((name) => {
      const parsed: unknown = load(readWorkflow(name))
      const jobs: Record<string, { steps?: RawStep[]; defaults?: { run?: Record<string, unknown> } }> =
        parsed !== null && typeof parsed === "object" && "jobs" in parsed ? Object(parsed.jobs) : {}
      return Object.entries(jobs).flatMap(([job, definition]) => {
        const steps = definition.steps ?? []
        const jobDirectory = definition.defaults?.run?.["working-directory"]
        const build = steps.findIndex(
          (step) =>
            typeof step.run === "string" &&
            BUILDS.test(step.run) &&
            (step["working-directory"] ?? jobDirectory) === undefined,
        )
        return build < 0 ? [] : [{ name: `${name} ${job}`, steps, build }]
      })
    })

  test("the preflight pins a node major", () => {
    expect(preflightMajor).toBe("24")
  })

  test.each(builders.map((builder) => [builder.name, builder] as const))("%s", (_name, { steps, build }) => {
    const pin = steps.findIndex((step) => nodeMajor(step) !== undefined)
    expect(pin, "no actions/setup-node before the build").toBeGreaterThanOrEqual(0)
    expect(pin).toBeLessThan(build)
    expect(nodeMajor(steps[pin] ?? {})).toBe(preflightMajor)
  })
})
