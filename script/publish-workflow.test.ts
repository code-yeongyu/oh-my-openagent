/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"

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
      "run: bun test src/shared/dist-bundle-bun-globals.test.ts",
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

  test("builds bundled MCP runtimes before Codex compatibility tests", () => {
    // #given
    const packageManifest = readFileSync(new URL("../package.json", import.meta.url), "utf8")

    // #when
    const codexTestScriptBuildsMcpRuntimes =
      packageManifest.includes(
        '"test:codex": "bun run build:ast-grep-mcp && bun run build:lsp-tools-mcp && bun run --cwd packages/omo-codex/plugin build && bun test',
      )

    // #then
    expect(codexTestScriptBuildsMcpRuntimes, "test:codex must build bundled MCP dists before installer tests copy them").toBe(true)
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
    const mainWaitsForPlatform = workflow.includes("needs: [test, typecheck, preflight-trust, release-metadata, publish-platform]") &&
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

  test("publishes the LazyCodex npm alias on every release while keeping marketplace sync explicit", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")

    // #when
    const keepsCodexPluginVersionIndependent =
      !workflow.includes("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/.codex-plugin/plugin.json") &&
      !workflow.includes("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/package.json")
    const flagDefaultsOff = workflow.includes("sync_lazycodex_marketplace:") &&
      workflow.includes('description: "Sync the LazyCodex Codex marketplace repository"') &&
      workflow.includes("default: false")
    const syncsLazycodexMarketplace = workflow.includes("bun run script/sync-lazycodex-marketplace.ts")
    const syncBuildsMcpDists =
      workflow.includes("bun run build:ast-grep-mcp") &&
      workflow.includes("bun run build:lsp-tools-mcp") &&
      workflow.indexOf("bun run build:lsp-tools-mcp") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const syncBuildsCodexPlugin =
      workflow.includes("bun run --cwd packages/omo-codex/plugin build") &&
      workflow.indexOf("bun run --cwd packages/omo-codex/plugin build") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const pushesLazycodexMarketplace = workflow.includes("code-yeongyu/lazycodex")
    const publishLazycodexStep = workflow.slice(
      workflow.indexOf("name: Publish lazycodex"),
      workflow.indexOf("name: Restore package.json after lazycodex publish attempt"),
    )
    const alwaysChecksLazycodexNpm = workflow.includes("name: Check if lazycodex already published") &&
      workflow.includes('https://registry.npmjs.org/lazycodex/${VERSION}')
    const publishesLazycodexNpm = publishLazycodexStep.includes("name: Publish lazycodex") &&
      publishLazycodexStep.includes("if: steps.check-lazycodex.outputs.skip != 'true'") &&
      publishLazycodexStep.includes("npm publish --access public --provenance --tag latest --loglevel verbose") &&
      !publishLazycodexStep.includes("continue-on-error: true")
    const gatesLazycodexMarketplaceSync = workflow.includes("name: Sync LazyCodex Codex marketplace") &&
      workflow.includes("if: inputs.sync_lazycodex_marketplace == true")
    const tokenRequirementBeforePublish = workflow.indexOf("name: Require LazyCodex sync token") <
      workflow.indexOf("publish-main:")
    const requiresLazycodexSyncToken = workflow.includes("LAZYCODEX_SYNC_TOKEN: ${{ secrets.LAZYCODEX_SYNC_TOKEN }}") &&
      workflow.includes("token: ${{ secrets.LAZYCODEX_SYNC_TOKEN }}") &&
      tokenRequirementBeforePublish

    // #then
    expect(keepsCodexPluginVersionIndependent, "LazyCodex plugin metadata must keep its own 0.1.0 version").toBe(true)
    expect(flagDefaultsOff, "LazyCodex marketplace sync must default to disabled").toBe(true)
    expect(syncsLazycodexMarketplace, "release must sync the LazyCodex marketplace bundle").toBe(true)
    expect(syncBuildsMcpDists, "release must build bundled MCP dists before LazyCodex marketplace sync").toBe(true)
    expect(syncBuildsCodexPlugin, "release must build the aggregate Codex plugin before LazyCodex marketplace sync").toBe(true)
    expect(pushesLazycodexMarketplace, "release must target the LazyCodex repository").toBe(true)
    expect(alwaysChecksLazycodexNpm, "release must always check lazycodex using the release version").toBe(true)
    expect(publishesLazycodexNpm, "lazycodex npm publish must be part of the normal release, tag stable releases as latest, and fail loudly").toBe(true)
    expect(gatesLazycodexMarketplaceSync, "LazyCodex marketplace push must require sync_lazycodex_marketplace=true").toBe(true)
    expect(requiresLazycodexSyncToken, "release must require a cross-repo token for LazyCodex push").toBe(true)
  })

  test("keeps lazycodex platform dependencies aligned with shim resolution", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const platformResolver = readFileSync(new URL("../bin/platform.js", import.meta.url), "utf8")

    // #when
    const lazycodexStepUsesReleaseVersion =
      !workflow.includes('LAZYCODEX_VERSION: "0.1.0"') &&
      workflow.includes(".name = \"lazycodex\" |") &&
      workflow.includes(".version = $omo_version |")
    const lazycodexStepUsesOpenagentPlatformVersion =
      workflow.includes('sub("^oh-my-opencode-"; "oh-my-openagent-")') &&
      workflow.includes("map(.key = (.key | sub")
    const lazycodexStepDoesNotRenameOptionalDeps = !workflow.includes('sub("^oh-my-opencode-"; "lazycodex-")')
    const shimMapsLazycodexToPublishedPlatformFamily =
      platformResolver.includes("lazycodex: \"oh-my-openagent\"")

    // #then
    expect(lazycodexStepUsesReleaseVersion, "lazycodex publish step must use the release version so unpublished versions are not reused").toBe(true)
    expect(lazycodexStepUsesOpenagentPlatformVersion, "lazycodex must depend on the matching oh-my-openagent platform packages").toBe(true)
    expect(lazycodexStepDoesNotRenameOptionalDeps, "lazycodex publish step must keep optionalDependencies on published platform packages").toBe(true)
    expect(shimMapsLazycodexToPublishedPlatformFamily, "platform resolver must map lazycodex to the oh-my-openagent platform package family").toBe(true)
  })
})
