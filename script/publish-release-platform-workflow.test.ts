/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"

import { PLATFORMS } from "./build-binaries"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const publishPlatformWorkflowPath = new URL("../.github/workflows/publish-platform.yml", import.meta.url)

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("release and platform publish workflows", () => {
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
    const mainWaitsForPlatform = workflow.includes(
      "needs: [gate-reuse, preflight-trust, release-metadata, prepare-release-state, publish-platform]",
    ) &&
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

  test("regenerates and commits release lockfiles only in the prepared source state", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareStep = sliceWorkflowSection(workflow, "      - name: Prepare release state (generation)", "      - name: Publish prepared release state")
    const releaseJob = workflow.slice(workflow.indexOf("  release:"))
    const codexLockfileCommand = "npm --prefix packages/omo-codex/plugin install --package-lock-only --ignore-scripts --no-audit --fund=false"
    const codexLockfilePath = "packages/omo-codex/plugin/package-lock.json"

    // #then
    expect(prepareStep).toContain(codexLockfileCommand)
    expect(prepareStep.indexOf(codexLockfileCommand)).toBeGreaterThan(prepareStep.indexOf("node packages/omo-codex/plugin/scripts/sync-version.mjs"))
    expect(prepareStep.indexOf("bun install --lockfile-only")).toBeGreaterThan(prepareStep.indexOf(codexLockfileCommand))
    expect(prepareStep).toContain(codexLockfilePath)
    expect(prepareStep).toContain("git commit -m \"release: v${VERSION}\"")
    expect(releaseJob).not.toContain("name: Apply release version to source tree")
    expect(releaseJob).not.toContain("name: Commit version bump")
  })

  test("validates an existing release tag before redispatching its prepared source", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const dispatchJob = sliceWorkflowSection(workflow, "  dispatch-provenance-safe-publish:", "  publish-main:")

    // #when
    const checksExistingTagTarget =
      dispatchJob.includes('if git rev-parse -q --verify "refs/tags/v${VERSION}" >/dev/null; then') &&
      dispatchJob.includes('TAG_SHA="$(git rev-list --max-count=1 "v${VERSION}")"') &&
      dispatchJob.includes('"$TAG_SHA" != "$RELEASE_SHA"')
    const createsMissingTagAtPreparedSource = dispatchJob.includes('git tag "v${VERSION}" "$RELEASE_SHA"')
    const redispatchesTag = dispatchJob.includes('gh workflow run publish.yml --ref "v${VERSION}"')
    const marketplacePushSkipsWhenClean = workflow.includes("LazyCodex marketplace already up to date")

    // #then
    expect(checksExistingTagTarget, "reruns must reject a release tag that points away from the prepared source").toBe(true)
    expect(createsMissingTagAtPreparedSource, "the first publish run must create its tag at the prepared source").toBe(true)
    expect(redispatchesTag, "the provenance-bearing publish run must be dispatched from the verified release tag").toBe(true)
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
    expect(publishYmlLists.length, "publish.yml must enumerate platforms in 2 PLATFORMS arrays + 2 prepared-source version-bump loops").toBe(4)
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

describe("release binary asset lane in the platform publish workflow", () => {
  test("plumbs omo_ai_version into the release-binary build", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")

    const callInputs = sliceWorkflowSection(workflow, "  workflow_call:", "  workflow_dispatch:")
    const dispatchInputs = workflow.slice(
      workflow.indexOf("  workflow_dispatch:"),
      workflow.indexOf("permissions:"),
    )
    const buildBinaryStep = sliceWorkflowSection(
      workflow,
      "      - name: Build release binary",
      "      - name: Smoke test release binary",
    )

    // #when
    const declaresInput =
      callInputs.includes("omo_ai_version:") && dispatchInputs.includes("omo_ai_version:")
    const buildStepUsesInput = buildBinaryStep.includes("OMO_AI_VERSION: ${{ inputs.omo_ai_version }}")
    const buildCommand =
      buildBinaryStep.includes("bun run script/build-omo-binary.ts") &&
      buildBinaryStep.includes('--target "${{ matrix.platform }}"') &&
      buildBinaryStep.includes('--omo-version "$OMO_VERSION"') &&
      buildBinaryStep.includes('--omo-ai-version "$OMO_AI_VERSION"')
    const bunPins = [...workflow.matchAll(/bun-version:\s*"([^"]+)"/g)].map((match) => match[1])
    const bunPinnedEverywhere = bunPins.length > 0 && bunPins.every((pin) => pin === "1.4.0")

    // #then
    expect(declaresInput, "omo_ai_version must be a workflow_call and workflow_dispatch input").toBe(true)
    expect(buildStepUsesInput, "the release-binary build must consume inputs.omo_ai_version").toBe(true)
    expect(
      buildCommand,
      "the build step must invoke build-omo-binary.ts for the matrix leg with both version inputs",
    ).toBe(true)
    expect(bunPinnedEverywhere, "every setup-bun step (existing and new) must pin bun 1.4.0").toBe(true)
  })

  test("gates release-binary steps on a release-asset probe, not the npm publish skip", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")
    const binaryLane = sliceWorkflowSection(
      workflow,
      "      - name: Check release assets",
      "      - name: Write job summary",
    )

    const probeStep = sliceWorkflowSection(
      binaryLane,
      "      - name: Check release assets",
      "      - name: Build release binary",
    )
    const binarySteps = [
      sliceWorkflowSection(
        binaryLane,
        "      - name: Build release binary",
        "      - name: Smoke test release binary",
      ),
      sliceWorkflowSection(
        binaryLane,
        "      - name: Smoke test release binary",
        "      - name: Upload release binary artifact",
      ),
      binaryLane.slice(binaryLane.indexOf("      - name: Upload release binary artifact")),
    ]

    // #when
    const probesReleaseAssets =
      probeStep.includes("gh release view") &&
      probeStep.includes("--json assets") &&
      probeStep.includes("binary_exists=") &&
      probeStep.includes("Invalid omo_ai_version")
    const gatedOnProbe = binarySteps.every((step) =>
      step.includes("if: steps.release-assets.outputs.binary_exists != 'true'"),
    )
    const neverNpmSkipped = binarySteps.every((step) => !step.includes("steps.check.outputs.skip"))

    // #then
    expect(
      probesReleaseAssets,
      "the binary-lane skip must key on a gh release asset-existence probe and validate omo_ai_version",
    ).toBe(true)
    expect(gatedOnProbe, "every release-binary step must gate on the asset probe output").toBe(true)
    expect(
      neverNpmSkipped,
      "release-binary steps must run regardless of the npm already-published skip",
    ).toBe(true)

    // upload shape: bare binaries + SHA256SUMS under .omo/release-binaries, npm-artifact parity on retention
    const uploadStep = binarySteps[2]!
    expect(uploadStep).toContain("uses: actions/upload-artifact@v6")
    expect(uploadStep).toContain("name: release-binary-${{ matrix.platform }}")
    expect(uploadStep).toContain("path: .omo/release-binaries/")
    expect(uploadStep).toContain("retention-days: 1")
    expect(uploadStep).toContain("if-no-files-found: error")
  })

  test("smokes every release binary leg on its matching runner class", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")
    const smokeStep = sliceWorkflowSection(
      workflow,
      "      - name: Smoke test release binary",
      "      - name: Upload release binary artifact",
    )

    const branch = (pattern: string): string => {
      const start = smokeStep.indexOf(pattern)
      if (start < 0) throw new Error(`missing smoke case branch: ${pattern}`)
      const end = smokeStep.indexOf(";;", start)
      if (end < 0) throw new Error(`unterminated smoke case branch: ${pattern}`)
      return smokeStep.slice(start, end)
    }

    // #when / #then
    // Exact stamped version assert: a missing sibling package.json silently
    // stamps 0.0.0, so the full line including the engine pin is compared.
    expect(smokeStep).toContain(
      'EXPECTED_VERSION_LINE="omo ${OMO_AI_VERSION} (engine: senpi ${ENGINE_PIN})"',
    )
    expect(smokeStep).toContain("ENGINE_PIN=")
    // isolation: every exec runs against fresh HOME/XDG/OMO_CODING_AGENT_DIR
    expect(smokeStep).toContain("mktemp -d")
    expect(smokeStep).toContain("XDG_CONFIG_HOME")
    expect(smokeStep).toContain("OMO_CODING_AGENT_DIR")
    // Node's Windows os.homedir() uses USERPROFILE, not Git Bash's HOME.
    expect(smokeStep).toContain('export USERPROFILE="${HOME}"')
    // first-run self-provisioning must materialize before any PASS
    expect(smokeStep).toContain("binary-runtime/${OMO_AI_VERSION}")
    // pty round-trip on the pty-capable legs
    expect(branch("darwin-arm64)")).toContain("pty_smoke")
    expect(branch("linux-x64|linux-x64-baseline)")).toContain("pty_smoke")
    expect(smokeStep).toContain("script -q")
    // oldstable-glibc container smoke on linux-x64
    expect(branch("linux-x64|linux-x64-baseline)")).toContain("oldstable_glibc_smoke")
    expect(smokeStep).toContain("debian:oldstable")
    // Rosetta attempt on darwin-x64 legs: tolerated failure, logged
    const darwinX64 = branch("darwin-x64|darwin-x64-baseline)")
    expect(darwinX64).toContain("Rosetta")
    expect(darwinX64).toContain("::warning::")
    // musl x64 legs run inside an alpine container
    const musl = branch("linux-x64-musl|linux-x64-musl-baseline)")
    expect(musl).toContain("musl_smoke")
    const muslSmokeFn = smokeStep.slice(
      smokeStep.indexOf("musl_smoke()"),
      smokeStep.indexOf("verify_checksum_and_size_only()"),
    )
    expect(muslSmokeFn).toContain("docker run")
    expect(muslSmokeFn).toContain("alpine:")
    expect(muslSmokeFn).toContain("apk add --no-cache libstdc++")
    // windows x64 legs exec natively; windows-arm64 is checksum+size only
    expect(branch("windows-x64|windows-x64-baseline)")).toContain("assert_version_line")
    const windowsArm64 = branch("windows-arm64)")
    expect(windowsArm64).toContain("verify_checksum_and_size_only")
    const checksumFn = smokeStep.slice(
      smokeStep.indexOf("verify_checksum_and_size_only()"),
      smokeStep.indexOf('case "$TARGET" in'),
    )
    expect(checksumFn).toContain("SHA256SUMS")
    expect(checksumFn).toContain("sha256sum -c")
    expect(
      windowsArm64,
      "no arm64 Windows runner exists; the binary must not be executed",
    ).not.toContain("--version")
    // arm64 linux legs defer to the dedicated arm64 runner job
    expect(branch("linux-arm64|linux-arm64-musl)")).toContain("smoke-linux-arm64")
    // unknown legs fail loud instead of silently passing
    expect(smokeStep).toContain("no smoke leg defined")
  })

  test("smokes arm64 linux binaries on a native arm64 runner with no fallback", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")
    const jobStart = workflow.indexOf("  smoke-linux-arm64:")
    if (jobStart < 0) throw new Error("missing smoke-linux-arm64 job")
    const job = workflow.slice(jobStart)
    const jobHeader = job.slice(0, job.indexOf("steps:"))

    // #when / #then
    expect(jobHeader).toContain("needs: build")
    expect(jobHeader).toContain("runs-on: ubuntu-24.04-arm")
    expect(
      jobHeader,
      "the arm64 label being unavailable must fail the job; no fallback runner",
    ).not.toContain("ubuntu-latest")
    expect(job).toContain("name: release-binary-linux-arm64")
    expect(job).toContain("name: release-binary-linux-arm64-musl")
    // glibc leg execs natively, musl leg runs in an alpine container
    expect(job).toContain("omo-linux-arm64")
    expect(job).toContain("alpine:")
    expect(job).toContain("apk add --no-cache libstdc++")
    // same exact version-line contract as the build-job smoke
    expect(job).toContain("(engine: senpi ${ENGINE_PIN})")
    expect(job).toContain("binary-runtime/${OMO_AI_VERSION}")
  })

  test("leaves npm publishing, runner routing, and matrix fail-fast untouched", () => {
    // #given
    const workflow = readFileSync(publishPlatformWorkflowPath, "utf8")
    const buildJob = sliceWorkflowSection(workflow, "  build:", "  publish:")
    const publishJob = sliceWorkflowSection(workflow, "  publish:", "  smoke-linux-arm64:")

    // #when / #then
    expect(buildJob).toContain(
      "runs-on: ${{ startsWith(matrix.platform, 'windows-') && 'windows-latest' || startsWith(matrix.platform, 'darwin-') && 'macos-latest' || 'ubuntu-latest' }}",
    )
    expect(buildJob).toContain("fail-fast: false")
    expect(publishJob).toContain(
      "if: steps.check.outputs.skip_opencode != 'true' && steps.download.outcome == 'success'",
    )
    expect(publishJob).toContain("if: steps.check.outputs.skip_all != 'true'")
    expect(publishJob, "the npm publish job must not grow release-binary steps").not.toContain(
      "release-binary",
    )
    expect(
      workflow,
      "the guards assert the release-binary lane exists alongside the untouched npm lane",
    ).toContain("name: Build release binary")
  })
})
