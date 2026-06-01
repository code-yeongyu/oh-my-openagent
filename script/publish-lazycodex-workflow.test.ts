/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("LazyCodex publish workflow", () => {
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
    const publishAliasDefaultsOn = workflow.includes("publish_lazycodex:") &&
      workflow.includes('description: "Publish the lazycodex-ai npm alias"') &&
      workflow.includes("default: true")
    const syncsLazycodexMarketplace = workflow.includes("bun run script/sync-lazycodex-marketplace.ts")
    const syncBuildsMcpDists =
      workflow.includes("bun run build:ast-grep-mcp") &&
      workflow.includes("bun run build:lsp-tools-mcp") &&
      workflow.indexOf("bun run build:lsp-tools-mcp") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const syncBuildsCodexPlugin =
      workflow.includes("bun run --cwd packages/omo-codex/plugin build") &&
      workflow.indexOf("bun run --cwd packages/omo-codex/plugin build") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const syncInstallsCodexPluginDeps =
      workflow.includes("npm --prefix packages/omo-codex/plugin ci") &&
      workflow.indexOf("npm --prefix packages/omo-codex/plugin ci") < workflow.indexOf("bun run --cwd packages/omo-codex/plugin build")
    const pushesLazycodexMarketplace = workflow.includes("code-yeongyu/lazycodex")
    const publishLazycodexStep = workflow.slice(
      workflow.indexOf("name: Publish lazycodex-ai"),
      workflow.indexOf("name: Restore package.json after lazycodex-ai publish attempt"),
    )
    const alwaysChecksLazycodexNpm = workflow.includes("name: Check if lazycodex-ai already published") &&
      workflow.includes('https://registry.npmjs.org/lazycodex-ai/${VERSION}')
    const publishesLazycodexNpm = publishLazycodexStep.includes("name: Publish lazycodex-ai") &&
      publishLazycodexStep.includes("if: inputs.publish_lazycodex == true && steps.check-lazycodex.outputs.skip != 'true'") &&
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
    expect(publishAliasDefaultsOn, "LazyCodex npm alias publish must stay enabled by default").toBe(true)
    expect(syncsLazycodexMarketplace, "release must sync the LazyCodex marketplace bundle").toBe(true)
    expect(syncBuildsMcpDists, "release must build bundled MCP dists before LazyCodex marketplace sync").toBe(true)
    expect(syncInstallsCodexPluginDeps, "release must install nested Codex plugin deps before building the aggregate plugin").toBe(true)
    expect(syncBuildsCodexPlugin, "release must build the aggregate Codex plugin before LazyCodex marketplace sync").toBe(true)
    expect(pushesLazycodexMarketplace, "release must target the LazyCodex repository").toBe(true)
    expect(alwaysChecksLazycodexNpm, "release must always check lazycodex using the release version").toBe(true)
    expect(publishesLazycodexNpm, "lazycodex npm publish must be part of the normal release, tag stable releases as latest, and fail loudly").toBe(true)
    expect(gatesLazycodexMarketplaceSync, "LazyCodex marketplace push must require sync_lazycodex_marketplace=true").toBe(true)
    expect(requiresLazycodexSyncToken, "release must require a cross-repo token for LazyCodex push").toBe(true)
  })

  test("can skip LazyCodex npm alias publishing when npm holds the package name", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const preflightJob = sliceWorkflowSection(workflow, "  preflight-trust:", "  release-metadata:")
    const updateVersionStep = sliceWorkflowSection(
      workflow,
      "      - name: Update version",
      "      - name: Build main package",
    )

    // #when
    const preflightMakesLazycodexConditional =
      preflightJob.includes("PUBLISH_LAZYCODEX: ${{ inputs.publish_lazycodex }}") &&
      preflightJob.includes('if [ "${PUBLISH_LAZYCODEX}" = "true" ]; then') &&
      preflightJob.includes("ALL_PACKAGES+=(lazycodex-ai)")
    const checkStepIsConditional = workflow.includes("id: check-lazycodex") &&
      workflow.includes("if: inputs.publish_lazycodex == true")
    const rebuildsOnlyWhenEnabledOrOtherPackagesNeedPublishing =
      updateVersionStep.includes("(inputs.publish_lazycodex == true && steps.check-lazycodex.outputs.skip != 'true')")
    const publishStepIsConditional = workflow.includes(
      "if: inputs.publish_lazycodex == true && steps.check-lazycodex.outputs.skip != 'true'",
    )
    const restoreStepIsConditional = workflow.includes(
      "if: always() && inputs.publish_lazycodex == true && steps.check-lazycodex.outputs.skip != 'true'",
    )

    // #then
    expect(preflightMakesLazycodexConditional, "trusted-publisher preflight must omit lazycodex when alias publishing is disabled").toBe(true)
    expect(checkStepIsConditional, "lazycodex npm status check must be skipped when alias publishing is disabled").toBe(true)
    expect(rebuildsOnlyWhenEnabledOrOtherPackagesNeedPublishing, "undefined lazycodex check outputs must not force rebuilds").toBe(true)
    expect(publishStepIsConditional, "lazycodex publish must be guarded by publish_lazycodex").toBe(true)
    expect(restoreStepIsConditional, "lazycodex restore must only run after a lazycodex publish attempt").toBe(true)
  })

  test("publishes lazycodex as a Node installer without Bun-backed runtime dependencies", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const platformResolver = readFileSync(new URL("../bin/platform.js", import.meta.url), "utf8")

    // #when
    const lazycodexStepUsesReleaseVersion =
      !workflow.includes('LAZYCODEX_VERSION: "0.1.0"') &&
      workflow.includes(".name = \"lazycodex-ai\" |") &&
      workflow.includes(".version = $omo_version |")
    const lazycodexStepUsesNodeInstallerBin =
      workflow.includes('.bin = { "lazycodex-ai": "packages/omo-codex/scripts/install-local.mjs", "lazycodex": "packages/omo-codex/scripts/install-local.mjs" }')
    const lazycodexStepDoesNotRenameOptionalDeps = !workflow.includes('sub("^oh-my-opencode-"; "lazycodex-")')
    const lazycodexStepDropsLifecycleScripts = workflow.includes(".scripts = {}")
    const lazycodexStepDropsPlatformOptionalDeps = workflow.includes(".optionalDependencies = {}")
    const lazycodexStepDropsRuntimeDependencies = workflow.includes(".dependencies = {}")
    const shimKeepsLazycodexMappedForSharedWrapper = platformResolver.includes("lazycodex: \"oh-my-openagent\"")

    // #then
    expect(lazycodexStepUsesReleaseVersion, "lazycodex publish step must use the release version so unpublished versions are not reused").toBe(true)
    expect(lazycodexStepUsesNodeInstallerBin, "lazycodex must execute the Node installer directly instead of the Bun-backed shared CLI").toBe(true)
    expect(lazycodexStepDoesNotRenameOptionalDeps, "lazycodex must never depend on lazycodex-named platform packages").toBe(true)
    expect(lazycodexStepDropsLifecycleScripts, "lazycodex publish step must not ship Bun-backed prepare/build lifecycle scripts").toBe(true)
    expect(lazycodexStepDropsPlatformOptionalDeps, "lazycodex publish step must not install Bun-backed platform launchers").toBe(true)
    expect(lazycodexStepDropsRuntimeDependencies, "lazycodex publish step must not install OpenCode CLI runtime dependencies").toBe(true)
    expect(shimKeepsLazycodexMappedForSharedWrapper, "platform resolver keeps lazycodex mapped when the shared wrapper is used outside the lazycodex package").toBe(true)
  })
})
