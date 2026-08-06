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
      "needs: [test, typecheck, codex-compatibility, preflight-trust, release-metadata, prepare-release-state, publish-platform]",
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
    const prepareStep = sliceWorkflowSection(workflow, "      - name: Prepare and merge release state before publishing", "      - name: Write job summary")
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
