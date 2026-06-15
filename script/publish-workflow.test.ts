/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { PLATFORMS } from "./build-binaries"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)
const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const publishPlatformWorkflowPath = new URL("../.github/workflows/publish-platform.yml", import.meta.url)
const workflowsDir = new URL("../.github/workflows/", import.meta.url)
const pinnedBunVersion = 'bun-version: "1.3.12"'
const workflowPaths = readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => new URL(name, workflowsDir))

const workflowChecks = [
  {
    path: ciWorkflowPath,
    testRuns: [
      "run: bun test",
      "run: bun test packages/omo-opencode/src/shared/dist-bundle-bun-globals.test.ts",
    ],
  },
  {
    path: publishWorkflowPath,
    testRuns: ["run: bun test"],
  },
]

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

function expectBunSetupBeforeLspToolsBuild(workflowSection: string, label: string): void {
  const bunSetupIndex = workflowSection.indexOf("uses: oven-sh/setup-bun@v2")
  const lspBuildIndex = workflowSection.indexOf("name: Build vendored lsp-tools-mcp package")

  expect(bunSetupIndex, `${label} must setup Bun`).toBeGreaterThanOrEqual(0)
  expect(lspBuildIndex, `${label} must build lsp-tools-mcp`).toBeGreaterThanOrEqual(0)
  expect(bunSetupIndex, `${label} must setup Bun before lsp-tools-mcp build`).toBeLessThan(lspBuildIndex)
}

describe("test workflows", () => {
  test("use pure bun test for workflows", () => {
    for (const workflowCheck of workflowChecks) {
      // #given
      const workflow = readFileSync(workflowCheck.path, "utf8")

      for (const testRun of workflowCheck.testRuns) {
        expect(workflow).toContain(testRun)
      }
    }
  })

  test("prepares vendored lsp-tools-mcp before publish workflow tests and typecheck", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const testJob = sliceWorkflowSection(workflow, "  test:", "  typecheck:")
    const typecheckJob = sliceWorkflowSection(workflow, "  typecheck:", "  preflight-trust:")

    // #when
    const testHasNodeSetup = testJob.includes('node-version: "24"')
    const testBuildsLspToolsMcp = testJob.includes("name: Build vendored lsp-tools-mcp package") &&
      testJob.includes("working-directory: packages/lsp-tools-mcp")

    const typecheckHasNodeSetup = typecheckJob.includes('node-version: "24"')
    const typecheckBuildsLspToolsMcp = typecheckJob.includes("name: Build vendored lsp-tools-mcp package") &&
      typecheckJob.includes("working-directory: packages/lsp-tools-mcp")

    // #then
    expect(testHasNodeSetup, "publish test job must setup Node for MCP package builds").toBe(true)
    expect(testBuildsLspToolsMcp, "publish test job must build lsp-tools-mcp before bun test").toBe(true)
    expect(typecheckHasNodeSetup, "publish typecheck job must setup Node for MCP package builds").toBe(true)
    expect(typecheckBuildsLspToolsMcp, "publish typecheck job must build lsp-tools-mcp before bun run typecheck").toBe(true)
  })

  test("runs Codex compatibility checks before publish jobs", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const codexCompatibilityJob = sliceWorkflowSection(workflow, "  codex-compatibility:", "  preflight-trust:")

    // #when
    const hasCodexMatrixJob = workflow.includes("codex-compatibility:")
    const hasSupportedOsMatrix = codexCompatibilityJob.includes("os: [ubuntu-latest, macos-latest, windows-latest]")
    const hasNodeSetup = codexCompatibilityJob.includes('node-version: "24"')
    const buildsLspToolsMcp =
      codexCompatibilityJob.includes("name: Build vendored lsp-tools-mcp package") &&
      codexCompatibilityJob.includes("working-directory: packages/lsp-tools-mcp") &&
      codexCompatibilityJob.indexOf("name: Build vendored lsp-tools-mcp package") <
        codexCompatibilityJob.indexOf("name: Run Codex compatibility tests")
    const runsCodexCommand = codexCompatibilityJob.includes("run: bun run test:codex")
    const publishMainNeedsCodex =
      workflow.includes("needs: [test, typecheck, codex-compatibility, preflight-trust, release-metadata, publish-platform]") &&
      workflow.includes("needs.codex-compatibility.result == 'success'")
    const publishPlatformNeedsCodex =
      workflow.includes("needs: [test, typecheck, codex-compatibility, preflight-trust, release-metadata]") &&
      workflow.includes("needs.codex-compatibility.result == 'success'")

    // #then
    expect(hasCodexMatrixJob, "publish workflow must expose a Codex compatibility job").toBe(true)
    expect(hasSupportedOsMatrix, "publish Codex compatibility must cover supported OSes").toBe(true)
    expect(hasNodeSetup, "publish Codex compatibility must setup Node for MCP package builds").toBe(true)
    expect(buildsLspToolsMcp, "publish Codex compatibility must build lsp-tools-mcp before bun run test:codex").toBe(true)
    expect(runsCodexCommand, "publish Codex compatibility must run the shared Codex test script").toBe(true)
    expect(publishMainNeedsCodex, "main wrapper publish must wait for Codex compatibility").toBe(true)
    expect(publishPlatformNeedsCodex, "platform publish must wait for Codex compatibility").toBe(true)
  })

  test("exercise root checks across linux macos and windows", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const hasCrossOsMatrix = workflow.includes("os: [ubuntu-latest, macos-latest, windows-latest]")
    const hasMatrixRunner = workflow.includes("runs-on: ${{ matrix.os }}")

    // #then
    expect(hasCrossOsMatrix, "CI root checks must cover Linux, macOS, and Windows").toBe(true)
    expect(hasMatrixRunner, "CI root checks must run on the selected matrix OS").toBe(true)
  })

  test("runs codex compatibility checks on every supported os", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const hasCodexMatrixJob = workflow.includes("codex-compatibility:")
    const hasCodexCommand = workflow.includes("run: bun run test:codex")
    const buildNeedsCodexMatrix = workflow.includes("needs: [test, typecheck, codex-compatibility]")

    // #then
    expect(hasCodexMatrixJob, "CI must expose a Codex compatibility matrix job").toBe(true)
    expect(hasCodexCommand, "Codex compatibility job must run the shared Codex test script").toBe(true)
    expect(buildNeedsCodexMatrix, "Build must wait for Codex compatibility checks").toBe(true)
  })

  test("prepares lsp-tools-mcp before Codex compatibility tests", () => {
    const workflow = readFileSync(ciWorkflowPath, "utf8")
    const codexCompatibilityJob = sliceWorkflowSection(workflow, "  codex-compatibility:", "  lazycodex-published-smoke:")

    const hasNodeSetup = codexCompatibilityJob.includes('node-version: "24"')
    const buildsLspToolsMcp =
      codexCompatibilityJob.includes("name: Build vendored lsp-tools-mcp package") &&
      codexCompatibilityJob.includes("working-directory: packages/lsp-tools-mcp") &&
      codexCompatibilityJob.indexOf("name: Build vendored lsp-tools-mcp package") <
        codexCompatibilityJob.indexOf("name: Run Codex compatibility tests")

    expect(hasNodeSetup, "Codex compatibility must setup Node for MCP package builds").toBe(true)
    expect(buildsLspToolsMcp, "Codex compatibility must build lsp-tools-mcp before bun run test:codex").toBe(true)
  })

  test("sets up Bun before vendored lsp-tools-mcp builds", () => {
    // #given
    const ciWorkflow = readFileSync(ciWorkflowPath, "utf8")
    const publishWorkflow = readFileSync(publishWorkflowPath, "utf8")
    const ciTestJob = sliceWorkflowSection(ciWorkflow, "  test:", "  typecheck:")
    const ciTypecheckJob = sliceWorkflowSection(ciWorkflow, "  typecheck:", "  codex-compatibility:")
    const ciCodexCompatibilityJob = sliceWorkflowSection(ciWorkflow, "  codex-compatibility:", "  lazycodex-published-smoke:")
    const ciBuildJob = sliceWorkflowSection(ciWorkflow, "  build:", "  draft-release:")
    const publishTestJob = sliceWorkflowSection(publishWorkflow, "  test:", "  typecheck:")
    const publishTypecheckJob = sliceWorkflowSection(publishWorkflow, "  typecheck:", "  codex-compatibility:")
    const publishCodexCompatibilityJob = sliceWorkflowSection(publishWorkflow, "  codex-compatibility:", "  preflight-trust:")

    // #then
    expectBunSetupBeforeLspToolsBuild(ciTestJob, "CI test job")
    expectBunSetupBeforeLspToolsBuild(ciTypecheckJob, "CI typecheck job")
    expectBunSetupBeforeLspToolsBuild(ciCodexCompatibilityJob, "CI Codex compatibility job")
    expectBunSetupBeforeLspToolsBuild(ciBuildJob, "CI build job")
    expectBunSetupBeforeLspToolsBuild(publishTestJob, "publish test job")
    expectBunSetupBeforeLspToolsBuild(publishTypecheckJob, "publish typecheck job")
    expectBunSetupBeforeLspToolsBuild(publishCodexCompatibilityJob, "publish Codex compatibility job")
  })

  test("builds bundled MCP runtimes before Codex compatibility tests", () => {
    // #given
    const packageManifest = readFileSync(new URL("../package.json", import.meta.url), "utf8")

    // #when
    const codexTestScriptBuildsMcpRuntimes =
      packageManifest.includes(
        '"test:codex": "bun run build:codex-install && bun run build:ast-grep-mcp && bun run build:git-bash-mcp && bun run build:lsp-tools-mcp && bun run build:lsp-daemon && npm --prefix packages/lsp-tools-mcp test && npm --prefix packages/omo-codex/plugin ci && bun run --cwd packages/omo-codex/plugin build && bun test',
      )

    // #then
    expect(codexTestScriptBuildsMcpRuntimes, "test:codex must build the generated Codex installer, install nested Codex plugin deps, and build bundled runtimes before installer tests copy them").toBe(true)
  })

  test("runs Git Bash installer regressions in Codex compatibility checks", () => {
    // #given
    const packageManifest = readFileSync(new URL("../package.json", import.meta.url), "utf8")

    // #when
    const codexTestScriptRunsGitBashRegressions =
      packageManifest.includes("packages/omo-codex/scripts/install-local-git-bash-preflight.test.mjs") &&
      packageManifest.includes("packages/omo-codex/scripts/install-generated-bundle.test.mjs")

    // #then
    expect(codexTestScriptRunsGitBashRegressions, "test:codex must cover Windows Git Bash preflight and install guidance").toBe(true)
  })

  test("tracks the nested Codex plugin lockfile used by npm ci", () => {
    // #given
    const gitignore = readFileSync(new URL("../.gitignore", import.meta.url), "utf8")

    // #when
    const lockfileIsUnignored = gitignore.includes("!packages/omo-codex/plugin/package-lock.json")
    const trackedLockfile = execFileSync("git", ["ls-files", "packages/omo-codex/plugin/package-lock.json"], {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    }).trim()

    // #then
    expect(lockfileIsUnignored, "the aggregate Codex plugin lockfile must escape the root package-lock ignore").toBe(true)
    expect(trackedLockfile, "npm ci in CI requires the nested Codex plugin package-lock.json to be tracked").toBe("packages/omo-codex/plugin/package-lock.json")
  })

  test("pins every workflow Bun setup to the tested runtime", () => {
    for (const workflowPath of workflowPaths) {
      // #given
      const workflow = readFileSync(workflowPath, "utf8")
      const bunVersionLines = workflow.match(/bun-version: .*/g) ?? []

      // #when
      const unpinnedBunLines = bunVersionLines.filter((line) => line !== pinnedBunVersion)

      // #then
      expect(unpinnedBunLines, `${workflowPath.pathname} must pin Bun to 1.3.12`).toEqual([])
    }
  })

  test("publishes platform packages before installable wrappers", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const computesReleaseMetadata = workflow.includes("release-metadata:") &&
      workflow.includes("outputs:") &&
      workflow.includes("version: ${{ steps.version.outputs.version }}") &&
      workflow.includes("dist_tag: ${{ steps.version.outputs.dist_tag }}")
    const computesVersionOnce = (workflow.match(/id: version/g) ?? []).length === 1
    const platformUsesMetadata = workflow.includes("version: ${{ needs.release-metadata.outputs.version }}") &&
      workflow.includes("dist_tag: ${{ needs.release-metadata.outputs.dist_tag }}")
    const mainWaitsForPlatform = workflow.includes("needs: [test, typecheck, codex-compatibility, preflight-trust, release-metadata, publish-platform]") &&
      workflow.includes("inputs.skip_platform == true || needs.publish-platform.result == 'success'")
    const releaseUsesMetadata = workflow.includes("VERSION: ${{ needs.release-metadata.outputs.version }}")
    const wrappersVerifyPlatformPackages = workflow.includes("name: Verify platform packages are published") &&
      workflow.includes("Missing platform package(s); refusing to publish wrappers.")

    // #then
    expect(computesReleaseMetadata, "release metadata must be a first-class job output").toBe(true)
    expect(computesVersionOnce, "version and dist tag must be computed exactly once").toBe(true)
    expect(platformUsesMetadata, "platform workflow must consume the shared release metadata").toBe(true)
    expect(mainWaitsForPlatform, "wrapper publish must wait for platform success unless pre-published platforms are explicitly verified").toBe(true)
    expect(releaseUsesMetadata, "release tail must use the shared release metadata").toBe(true)
    expect(wrappersVerifyPlatformPackages, "wrappers must verify matching platform binaries exist before npm publish").toBe(true)
  })

  test("runs published lazycodex-ai smoke commands from a clean external directory", () => {
    // #given
    const workflow = readFileSync(ciWorkflowPath, "utf8")

    // #when
    const hasSmokeJob = workflow.includes("lazycodex-published-smoke:")
    const smokeIsNonBlocking = workflow.includes("lazycodex-published-smoke:") &&
      workflow.includes("continue-on-error: true")
    const hasExternalSmokeDir = workflow.includes("SMOKE_DIR=$(mktemp -d)") &&
      workflow.includes('cd "$SMOKE_DIR/cwd"')
    const isolatesCodexState =
      workflow.includes("HOME: ${{ runner.temp }}/lazycodex-published-smoke/home") &&
      workflow.includes("CODEX_HOME: ${{ runner.temp }}/lazycodex-published-smoke/codex") &&
      workflow.includes("CODEX_LOCAL_BIN_DIR: ${{ runner.temp }}/lazycodex-published-smoke/bin")
    const runsNpxInstallSmoke = workflow.includes(
      "npx -y lazycodex-ai@latest --dry-run install --no-tui --codex-autonomous",
    )
    const runsNpxDoctorSmoke = workflow.includes(
      "npx -y lazycodex-ai@latest --dry-run doctor",
    )
    const warnsOnInstallMismatch = workflow.includes("::warning::lazycodex-ai install dry-run output changed:")
    const warnsOnDoctorMismatch = workflow.includes("::warning::lazycodex-ai doctor dry-run output changed:")
    const removedStrictInstallGate = !workflow.includes(
      'test "$npx_install_output" = "npx --yes --package oh-my-openagent omo install --platform=codex --no-tui --codex-autonomous"',
    )
    const removedStrictDoctorGate = !workflow.includes(
      'test "$npx_doctor_output" = "npx --yes --package oh-my-openagent omo doctor"',
    )

    // #then
    expect(hasSmokeJob, "CI must expose a published LazyCodex registry smoke job").toBe(true)
    expect(smokeIsNonBlocking, "published lazycodex smoke must not block CI before the next alias release reaches npm latest").toBe(true)
    expect(hasExternalSmokeDir, "published lazycodex smoke must run from an external temp directory").toBe(true)
    expect(isolatesCodexState, "published lazycodex smoke must isolate HOME and Codex install paths").toBe(true)
    expect(runsNpxInstallSmoke, "publish workflow must run npx lazycodex-ai install smoke from npm").toBe(true)
    expect(runsNpxDoctorSmoke, "publish workflow must run npx lazycodex-ai doctor smoke from npm").toBe(true)
    expect(warnsOnInstallMismatch, "publish workflow must warn instead of failing when lazycodex install output changes").toBe(true)
    expect(warnsOnDoctorMismatch, "publish workflow must warn instead of failing when lazycodex doctor output changes").toBe(true)
    expect(removedStrictInstallGate, "publish workflow must not use the strict lazycodex install equality gate").toBe(true)
    expect(removedStrictDoctorGate, "publish workflow must not use the strict lazycodex doctor equality gate").toBe(true)
  })

  test("fails when a required platform artifact is missing", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const downloadStep = sliceWorkflowSection(
      workflow,
      "      - name: Download artifact",
      "      - name: Extract artifact",
    )
    const downloadsWhenPublishNeeded = downloadStep.includes("if: steps.check.outputs.skip_all != 'true'")
    const suppressesDownloadFailure = downloadStep.includes("continue-on-error: true")

    // #then
    expect(downloadsWhenPublishNeeded, "publish job must download artifacts for packages that still need publishing").toBe(true)
    expect(suppressesDownloadFailure, "missing required artifacts must fail the reusable publish workflow").toBe(false)
  })

  test("publishes openagent platform packages even when legacy opencode publish is unavailable", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const opencodePublishStep = sliceWorkflowSection(
      workflow,
      "      - name: Publish oh-my-opencode-${{ matrix.platform }}",
      "      - name: Publish oh-my-openagent-${{ matrix.platform }}",
    )
    const openagentPublishStep = sliceWorkflowSection(
      workflow,
      "      - name: Publish oh-my-openagent-${{ matrix.platform }}",
      "        timeout-minutes: 15",
    )

    // #then
    expect(opencodePublishStep.includes("continue-on-error: true"), "legacy opencode package publish must not block renamed platform publish").toBe(true)
    expect(openagentPublishStep.includes("if: always() && steps.check.outputs.skip_openagent != 'true' && steps.download.outcome == 'success'"), "renamed platform publish must run after legacy publish failures").toBe(true)
    expect(openagentPublishStep.includes(".bin ="), "renamed internal platform packages must not require public bin metadata").toBe(false)
  })

  test("keeps the platform publish workflow step syntax valid around version updates", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const duplicateVersionStep = workflow.includes(
      "      - name: Update version in package.json\n      - name: Update version in package.json",
    )

    // #then
    expect(duplicateVersionStep, "platform publish workflow must not contain adjacent duplicate step names").toBe(false)
  })

  test("publishes platform launchers without Bun compile", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    // #when
    const buildStep = sliceWorkflowSection(
      workflow,
      "      - name: Build launcher",
      "      - name: Verify darwin launcher",
    )
    const darwinVerifyStep = sliceWorkflowSection(
      workflow,
      "      - name: Verify darwin launcher",
      "      - name: Compress binary",
    )

    // #then
    expect(buildStep).toContain("bun run build:binaries")
    expect(buildStep).toContain("bin/oh-my-opencode.js")
    expect(buildStep).not.toContain("bun build packages/omo-opencode/src/cli/index.ts --compile")
    expect(darwinVerifyStep).toContain("#!/usr/bin/env node")
    expect(darwinVerifyStep).not.toContain("codesign")
  })

  test("regenerates and commits bun.lock in the release version bump", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const applyStep = sliceWorkflowSection(workflow, "      - name: Apply release version to source tree", "      - name: Commit version bump")
    const commitStep = sliceWorkflowSection(workflow, "      - name: Commit version bump", "      - name: Create release tag")

    // #then
    expect(applyStep).toContain("bun install --lockfile-only")
    expect(applyStep.indexOf("bun install --lockfile-only")).toBeGreaterThan(applyStep.indexOf("node packages/omo-codex/plugin/scripts/sync-version.mjs"))
    expect(commitStep).toContain(" bun.lock")
  })

  test("keeps the release tail safe to rerun after a tag exists", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const hasExistingTagResolver = workflow.includes("id: release-state") &&
      workflow.includes("tag_exists=true") &&
      workflow.includes('git checkout --detach "v${VERSION}"')
    const tagStepSkipsExistingTag = workflow.includes("if: steps.release-state.outputs.tag_exists != 'true'")
    const noHardExistingTagFailure = !workflow.includes("Tag v${VERSION} already exists")
    const pushSkipsExistingRemoteTag = workflow.includes("Release tag v${VERSION} already exists on origin")
    const marketplacePushSkipsWhenClean = workflow.includes("LazyCodex marketplace already up to date")

    // #then
    expect(hasExistingTagResolver, "release must detect and reuse an existing tag on rerun").toBe(true)
    expect(tagStepSkipsExistingTag, "tag creation must skip when the release tag already exists").toBe(true)
    expect(noHardExistingTagFailure, "existing tags must not make reruns fail").toBe(true)
    expect(pushSkipsExistingRemoteTag, "tag push must be skip-if-exists").toBe(true)
    expect(marketplacePushSkipsWhenClean, "marketplace sync must skip push when rerun has no changes").toBe(true)
  })

  test("enumerates windows-arm64 consistently across every platform-list surface", () => {
    // #given
    const publishSource = readFileSync(new URL("../script/publish.ts", import.meta.url), "utf8")
    const publishPlatformWorkflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    const publishIdsBlock = publishSource.slice(
      publishSource.indexOf("PLATFORM_PACKAGE_IDS = ["),
      publishSource.indexOf("] as const"),
    )
    const publishIds = [...publishIdsBlock.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]).sort()

    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()

    const matrixLists = [...publishPlatformWorkflow.matchAll(/^\s*platform: \[([^\]]+)\]/gm)].map((match) =>
      match[1]
        .split(",")
        .map((value) => value.trim())
        .sort(),
    )

    const publishWorkflow = readFileSync(publishWorkflowPath, "utf8")
    const publishYmlLists = [
      ...[...publishWorkflow.matchAll(/PLATFORMS=\(([^)]+)\)/g)].map((match) => match[1]),
      ...[...publishWorkflow.matchAll(/for platform in (darwin-arm64[^\n;]*); do/g)].map((match) => match[1]),
    ].map((list) => list.trim().split(/\s+/).sort())

    // #when / #then
    expect(publishIds, "PLATFORM_PACKAGE_IDS must list windows-arm64").toContain("windows-arm64")
    expect(buildBinariesPlatforms, "build-binaries PLATFORMS must list windows-arm64").toContain("windows-arm64")
    expect(matrixLists.length, "publish-platform.yml must define both build and publish matrices").toBe(2)
    for (const matrixList of matrixLists) {
      expect(matrixList, "every publish-platform matrix must list windows-arm64").toContain("windows-arm64")
      expect(matrixList, "publish-platform matrix must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
    expect(publishIds, "PLATFORM_PACKAGE_IDS must match build-binaries PLATFORMS exactly").toEqual(
      buildBinariesPlatforms,
    )
    expect(publishYmlLists.length, "publish.yml must enumerate platforms in 2 PLATFORMS arrays + 2 version-bump loops").toBe(4)
    for (const publishYmlList of publishYmlLists) {
      expect(publishYmlList, "every publish.yml platform list must match build-binaries PLATFORMS exactly").toEqual(
        buildBinariesPlatforms,
      )
    }
  })

  test("matches the canonical platform set in optionalDependencies and on-disk platform packages", () => {
    // #given
    const rootManifest: { optionalDependencies?: Record<string, string> } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    )
    const buildBinariesPlatforms = PLATFORMS.map((entry) => entry.platform).sort()
    const platformPrefix = "oh-my-opencode-"

    const optionalDependencyPlatforms = Object.keys(rootManifest.optionalDependencies ?? {})
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    const onDiskPlatforms = readdirSync(new URL("../packages/", import.meta.url))
      .filter((name) => name.startsWith(platformPrefix))
      .map((name) => name.slice(platformPrefix.length))
      .sort()

    // #when / #then
    expect(
      optionalDependencyPlatforms,
      "root optionalDependencies must list every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
    expect(
      onDiskPlatforms,
      "packages/ must contain a directory for every canonical platform package",
    ).toEqual(buildBinariesPlatforms)
  })

})
