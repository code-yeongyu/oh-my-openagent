/// <reference types="bun-types" />

// allow: SIZE_OK - LazyCodex publish workflow tests exercise one release workflow fixture; this release adds narrow payload assertions and future additions should split by publish step.

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const publishWorkflowPath = new URL("../.github/workflows/publish.yml", import.meta.url)
const webTerminalVisualQaRuntimePaths = [
  "script/qa/strip-ansi.mjs",
  "script/qa/web-terminal-redaction.d.mts",
  "script/qa/web-terminal-redaction.mjs",
  "script/qa/web-terminal-visual-qa.mjs",
  "script/qa/xterm-live-terminal.mjs",
] as const
const packageGuidanceDocPaths = [
  "docs/reference/github-attachment-upload.md",
  "docs/reference/web-terminal-visual-qa.md",
] as const
const lazycodexRuntimePayloadPaths = [
  "dist/cli",
  "dist/cli-node",
  "packages/omo-codex/plugin/components/bootstrap/dist/cli.js",
  "packages/omo-codex/plugin/components/bootstrap/scripts/bootstrap.ps1",
  "packages/omo-codex/plugin/components/bootstrap/scripts/node-dispatch.ps1",
  "packages/omo-codex/plugin/components/codegraph/dist/cli.js",
  "packages/omo-codex/plugin/components/codegraph/dist/serve.js",
  "packages/omo-codex/plugin/components/comment-checker/dist/cli.js",
  "packages/omo-codex/plugin/components/git-bash/dist/cli.js",
  "packages/omo-codex/plugin/components/lazycodex-executor-verify/dist/cli.js",
  "packages/omo-codex/plugin/components/lsp/dist/cli.js",
  "packages/omo-codex/plugin/components/rules/dist/cli.js",
  "packages/omo-codex/plugin/components/start-work-continuation/dist/cli.js",
  "packages/omo-codex/plugin/components/teammode/dist/cli.js",
  "packages/omo-codex/plugin/components/telemetry/dist/cli.js",
  "packages/omo-codex/plugin/components/ultrawork/dist/cli.js",
  "packages/omo-codex/plugin/components/ulw-loop/dist/cli.js",
] as const

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("LazyCodex publish workflow", () => {
  test("publishes a LazyCodex GitHub release only when the marketplace payload changed", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const releaseMetadataJob = sliceWorkflowSection(workflow, "  release-metadata:", "  publish-main:")
    const lazycodexReleaseStateStep = sliceWorkflowSection(
      workflow,
      "      - name: Resolve LazyCodex release payload",
      "      - name: Create LazyCodex GitHub release",
    )
    const lazycodexReleaseStep = sliceWorkflowSection(
      workflow,
      "      - name: Create LazyCodex GitHub release",
      "      - name: Create GitHub release",
    )
    const syncMarketplaceStep = sliceWorkflowSection(
      workflow,
      "      - name: Sync LazyCodex Codex marketplace",
      "      - name: Resolve LazyCodex release payload",
    )
    const buildMainPackageStep = sliceWorkflowSection(
      workflow,
      "      - name: Build main package",
      "      - name: Strip token auth from .npmrc to force OIDC",
    )

    // #when
    const stampsCodexPluginMetadata =
      workflow.includes("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/.codex-plugin/plugin.json") &&
      workflow.includes("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/package.json")
    const lazycodexSyncHasNoManualOptOut = !workflow.includes("sync_lazycodex_marketplace")
    const publishAliasDefaultsOn = workflow.includes("publish_lazycodex:") &&
      workflow.includes('description: "Publish the lazycodex-ai npm alias"') &&
      workflow.includes("default: true")
    const syncsLazycodexMarketplace = workflow.includes("bun run script/sync-lazycodex-marketplace.ts")
    const syncBuildsMcpDists =
      workflow.includes("bun run build:git-bash-mcp") &&
      workflow.includes("bun run build:lsp-tools-mcp") &&
      workflow.includes("bun run build:lsp-daemon") &&
      workflow.indexOf("bun run build:git-bash-mcp") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts") &&
      workflow.indexOf("bun run build:lsp-tools-mcp") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts") &&
      workflow.indexOf("bun run build:lsp-daemon") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const syncBuildsCodexPlugin =
      workflow.includes("bun run --cwd packages/omo-codex/plugin build") &&
      workflow.indexOf("bun run --cwd packages/omo-codex/plugin build") < workflow.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const npmPublishBuildsReleaseStampedInstallerAndLspDistBeforeMainPackage =
      buildMainPackageStep.includes("bun run build:codex-install && bun run build:lsp-tools-mcp && bun run build")
    const syncStampsMetadataBeforeBuild =
      syncMarketplaceStep.indexOf("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/.codex-plugin/plugin.json") >= 0 &&
      syncMarketplaceStep.indexOf("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/package.json") >= 0 &&
      syncMarketplaceStep.indexOf("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/.codex-plugin/plugin.json") <
        syncMarketplaceStep.indexOf("bun run --cwd packages/omo-codex/plugin build") &&
      syncMarketplaceStep.indexOf("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/package.json") <
        syncMarketplaceStep.indexOf("bun run --cwd packages/omo-codex/plugin build")
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
      publishLazycodexStep.includes("npm publish --ignore-scripts --access public --provenance --tag latest --loglevel verbose") &&
      !publishLazycodexStep.includes("continue-on-error: true")
    const syncsLazycodexMarketplaceOnStableReleases = workflow.includes("name: Sync LazyCodex Codex marketplace") &&
      syncMarketplaceStep.includes("if: needs.release-metadata.outputs.dist_tag == ''") &&
      lazycodexReleaseStateStep.includes("if: needs.release-metadata.outputs.dist_tag == ''")
    const tokenRequirementBeforePublish = workflow.indexOf("name: Require LazyCodex sync token") <
      workflow.indexOf("publish-main:")
    const requiresLazycodexSyncToken = workflow.includes("LAZYCODEX_SYNC_TOKEN: ${{ secrets.LAZYCODEX_SYNC_TOKEN }}") &&
      workflow.includes("token: ${{ secrets.LAZYCODEX_SYNC_TOKEN }}") &&
      tokenRequirementBeforePublish
    const capturesPreviousLazycodexBeforePublishing =
      releaseMetadataJob.includes("previous_lazycodex_version: ${{ steps.version.outputs.previous_lazycodex_version }}") &&
      releaseMetadataJob.includes("LAZYCODEX_COMPARE_TAG=\"${DIST_TAG:-latest}\"") &&
      releaseMetadataJob.includes("npm view \"lazycodex-ai@${LAZYCODEX_COMPARE_TAG}\" version") &&
      lazycodexReleaseStateStep.includes("PREVIOUS_LAZYCODEX_VERSION: ${{ needs.release-metadata.outputs.previous_lazycodex_version }}")
    const comparesAgainstPreviousLazycodexVersion =
      lazycodexReleaseStateStep.includes("npm pack \"lazycodex-ai@${PREVIOUS_LAZYCODEX_VERSION}\"") &&
      lazycodexReleaseStateStep.includes("bun run script/sync-lazycodex-marketplace.ts \"$PREVIOUS_PACKAGE_ROOT\" \"$PREVIOUS_MARKETPLACE_ROOT\" --previous-payload") &&
      lazycodexReleaseStateStep.includes("diff -qr \"$PREVIOUS_MARKETPLACE_ROOT/.agents/plugins/marketplace.json\" \"$CURRENT_MARKETPLACE_ROOT/.agents/plugins/marketplace.json\"") &&
      lazycodexReleaseStateStep.includes("diff -qr \"$PREVIOUS_MARKETPLACE_ROOT/.github/workflows/pr-source-guidance.yml\" \"$CURRENT_MARKETPLACE_ROOT/.github/workflows/pr-source-guidance.yml\"") &&
      lazycodexReleaseStateStep.includes("diff -qr \"$PREVIOUS_MARKETPLACE_ROOT/plugins/omo\" \"$CURRENT_MARKETPLACE_ROOT/plugins/omo\"") &&
      !syncMarketplaceStep.includes("--previous-payload")
    const exposesChangedOutput =
      lazycodexReleaseStateStep.includes("lazycodex_changed=true") &&
      lazycodexReleaseStateStep.includes("lazycodex_changed=false") &&
      lazycodexReleaseStateStep.includes("previous_lazycodex_version=${PREVIOUS_LAZYCODEX_VERSION}")
    const createsLazycodexReleaseOnlyWhenChanged =
      lazycodexReleaseStep.includes(
        "if: needs.release-metadata.outputs.dist_tag == '' && steps.lazycodex-release-state.outputs.lazycodex_changed == 'true'",
      ) &&
      lazycodexReleaseStep.includes("GH_TOKEN: ${{ secrets.LAZYCODEX_SYNC_TOKEN }}") &&
      lazycodexReleaseStep.includes('gh release create "v${VERSION}" --repo code-yeongyu/lazycodex') &&
      lazycodexReleaseStep.includes("--notes-file /tmp/lazycodex-release-notes.md")

    // #then
    expect(stampsCodexPluginMetadata, "LazyCodex plugin metadata must be stamped with the release version").toBe(true)
    expect(
      lazycodexSyncHasNoManualOptOut,
      "LazyCodex marketplace sync must not expose a manual opt-out input",
    ).toBe(true)
    expect(publishAliasDefaultsOn, "LazyCodex npm alias publish must stay enabled by default").toBe(true)
    expect(syncsLazycodexMarketplace, "release must sync the LazyCodex marketplace bundle").toBe(true)
    expect(syncBuildsMcpDists, "release must build bundled MCP dists before LazyCodex marketplace sync").toBe(true)
    expect(npmPublishBuildsReleaseStampedInstallerAndLspDistBeforeMainPackage, "release must regenerate the Codex installer and build LSP dist before npm packages include them").toBe(true)
    expect(syncInstallsCodexPluginDeps, "release must install nested Codex plugin deps before building the aggregate plugin").toBe(true)
    expect(syncBuildsCodexPlugin, "release must build the aggregate Codex plugin before LazyCodex marketplace sync").toBe(true)
    expect(syncStampsMetadataBeforeBuild, "release must stamp Codex plugin metadata before LazyCodex marketplace build").toBe(true)
    expect(pushesLazycodexMarketplace, "release must target the LazyCodex repository").toBe(true)
    expect(alwaysChecksLazycodexNpm, "release must always check lazycodex using the release version").toBe(true)
    expect(publishesLazycodexNpm, "lazycodex npm publish must be part of the normal release, tag stable releases as latest, and fail loudly").toBe(true)
    expect(
      syncsLazycodexMarketplaceOnStableReleases,
      "LazyCodex marketplace sync must run on every stable release (empty dist_tag)",
    ).toBe(true)
    expect(requiresLazycodexSyncToken, "release must require a cross-repo token for LazyCodex push").toBe(true)
    expect(capturesPreviousLazycodexBeforePublishing, "release metadata must capture the previous lazycodex-ai version before publishing the new one").toBe(true)
    expect(comparesAgainstPreviousLazycodexVersion, "LazyCodex release state must compare current payload with the previous lazycodex-ai package").toBe(true)
    expect(exposesChangedOutput, "LazyCodex release state must expose changed and previous-version outputs").toBe(true)
    expect(createsLazycodexReleaseOnlyWhenChanged, "LazyCodex GitHub release must target code-yeongyu/lazycodex only when payload changed").toBe(true)
  })

  test("skips the LazyCodex GitHub release when the previous payload is unchanged", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const lazycodexReleaseStateStep = sliceWorkflowSection(
      workflow,
      "      - name: Resolve LazyCodex release payload",
      "      - name: Create LazyCodex GitHub release",
    )
    const lazycodexReleaseStep = sliceWorkflowSection(
      workflow,
      "      - name: Create LazyCodex GitHub release",
      "      - name: Create GitHub release",
    )

    // #when
    const unchangedPathWritesFalse =
      lazycodexReleaseStateStep.includes("LazyCodex payload unchanged from lazycodex-ai@${PREVIOUS_LAZYCODEX_VERSION}") &&
      lazycodexReleaseStateStep.includes("echo \"lazycodex_changed=false\" >> \"$GITHUB_OUTPUT\"")
    const releaseStepRequiresChangedOutput =
      lazycodexReleaseStep.includes("steps.lazycodex-release-state.outputs.lazycodex_changed == 'true'")
    const mainReleaseStillExists = workflow.includes("      - name: Create GitHub release") &&
      workflow.includes("GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}")

    // #then
    expect(unchangedPathWritesFalse, "unchanged LazyCodex payload must write lazycodex_changed=false").toBe(true)
    expect(releaseStepRequiresChangedOutput, "LazyCodex release step must skip when lazycodex_changed is false").toBe(true)
    expect(mainReleaseStillExists, "main repository release creation must stay independent").toBe(true)
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
    const publishLazycodexStep = sliceWorkflowSection(
      workflow,
      "      - name: Publish lazycodex-ai",
      "      - name: Smoke test published lazycodex-ai",
    )
    const missingLazycodexRuntimePayloadPaths = lazycodexRuntimePayloadPaths.filter(
      (runtimePath) => !publishLazycodexStep.includes(`"${runtimePath}"`),
    )
    const missingWebTerminalRuntimePaths = webTerminalVisualQaRuntimePaths.filter(
      (runtimePath) => !publishLazycodexStep.includes(`"${runtimePath}"`),
    )
    const missingPackageGuidanceDocPaths = packageGuidanceDocPaths.filter(
      (docPath) => !publishLazycodexStep.includes(`"${docPath}"`),
    )
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")
    const lazycodexShipsRootCliDistAfterBuild =
      publishMainJob.indexOf("bun run build:codex-install && bun run build:lsp-tools-mcp && bun run build:lsp-daemon && bun run build") >= 0 &&
      publishMainJob.indexOf("bun run build:codex-install && bun run build:lsp-tools-mcp && bun run build:lsp-daemon && bun run build") <
        publishMainJob.indexOf("name: Publish lazycodex-ai")
    const shimKeepsLazycodexMappedForSharedWrapper = platformResolver.includes("lazycodex: \"oh-my-openagent\"")

    // #then
    expect(lazycodexStepUsesReleaseVersion, "lazycodex publish step must use the release version so unpublished versions are not reused").toBe(true)
    expect(lazycodexStepUsesNodeInstallerBin, "lazycodex must execute the Node installer directly instead of the Bun-backed shared CLI").toBe(true)
    expect(lazycodexStepDoesNotRenameOptionalDeps, "lazycodex must never depend on lazycodex-named platform packages").toBe(true)
    expect(lazycodexStepDropsLifecycleScripts, "lazycodex publish step must not ship Bun-backed prepare/build lifecycle scripts").toBe(true)
    expect(lazycodexStepDropsPlatformOptionalDeps, "lazycodex publish step must not install Bun-backed platform launchers").toBe(true)
    expect(lazycodexStepDropsRuntimeDependencies, "lazycodex publish step must not install OpenCode CLI runtime dependencies").toBe(true)
    expect(
      missingLazycodexRuntimePayloadPaths.length === 0,
      "lazycodex npm package must ship the root CLI dist (omo runtime wrapper target), web-terminal QA helper runtime, the Node installer and Codex marketplace assets, and packages/lsp-daemon (lsp MCP arg target and components/lsp file: dependency — npm ci in the plugin cache hard-fails without it)",
    ).toBe(true)
    expect(missingWebTerminalRuntimePaths).toEqual([])
    expect(missingPackageGuidanceDocPaths).toEqual([])
    expect(
      lazycodexShipsRootCliDistAfterBuild,
      "publish-main must build the root CLI dist before the lazycodex-ai publish step so dist/cli/index.js exists in the tarball",
    ).toBe(true)
    expect(shimKeepsLazycodexMappedForSharedWrapper, "platform resolver keeps lazycodex mapped when the shared wrapper is used outside the lazycodex package").toBe(true)
  })

  test("smoke tests the published LazyCodex alias after npm publish", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishIndex = workflow.indexOf("name: Publish lazycodex-ai")
    const smokeIndex = workflow.indexOf("name: Smoke test published lazycodex-ai")
    const restoreIndex = workflow.indexOf("name: Restore package.json after lazycodex-ai publish attempt")
    const smokeStep = sliceWorkflowSection(
      workflow,
      "      - name: Smoke test published lazycodex-ai",
      "      - name: Restore package.json after lazycodex-ai publish attempt",
    )

    // #when
    const smokeRunsAfterPublishBeforeRestore = publishIndex >= 0 &&
      smokeIndex > publishIndex &&
      restoreIndex > smokeIndex
    const smokesReleaseVersion = smokeStep.includes('smoke_lazycodex_package "lazycodex-ai@${OMO_VERSION}"')
    const smokesStableLatestOnly = smokeStep.includes('if [ -z "$DIST_TAG" ]; then') &&
      smokeStep.includes('smoke_lazycodex_package "lazycodex-ai@latest"')
    const retriesRegistryPropagation = smokeStep.includes("for attempt in $(seq 1 12)") &&
      smokeStep.includes("registry propagation")
    const isolatesCodexState = smokeStep.includes('export HOME="$SMOKE_DIR/home"') &&
      smokeStep.includes('export CODEX_HOME="$SMOKE_DIR/codex"') &&
      smokeStep.includes('export CODEX_LOCAL_BIN_DIR="$SMOKE_DIR/bin"')
    const assertsDryRunRouting = smokeStep.includes('npx -y "$package_spec" --dry-run install --no-tui --codex-autonomous') &&
      smokeStep.includes('npx -y "$package_spec" --dry-run doctor') &&
      smokeStep.includes('expected_install_output="npx --yes oh-my-openagent@latest install --platform=codex --no-tui --codex-autonomous"') &&
      smokeStep.includes('expected_doctor_output_prefix="codex exec ') &&
      smokeStep.includes("npx --yes oh-my-openagent@latest install --platform=codex --no-tui --codex-autonomous") &&
      smokeStep.includes('case "$npx_doctor_output" in "$expected_doctor_output_prefix"*) true ;; *) false ;; esac') &&
      smokeStep.includes('case "$npx_doctor_output" in *"--sandbox danger-full-access"*) true ;; *) false ;; esac') &&
      smokeStep.includes('expected_doctor_hint="Use \\$omo:lcx-doctor"') &&
      smokeStep.includes('case "$npx_doctor_output" in *"$expected_doctor_hint"*) true ;; *) false ;; esac') &&
      smokeStep.includes('case "$npx_doctor_output" in *"--model"*|*"gpt-5.5-codex-mini"*) false ;; *) true ;; esac') &&
      !smokeStep.includes("npx --yes --package oh-my-openagent omo install") &&
      !smokeStep.includes("--platform=claude-code") &&
      !smokeStep.includes("--platform=gemini")
    const installsRealPackageAndVerifiesOmoBin =
      smokeStep.includes('npx -y "$package_spec" install --no-tui --codex-autonomous') &&
      smokeStep.includes('[ -x "$CODEX_LOCAL_BIN_DIR/omo" ]') &&
      smokeStep.includes('omo_version_output=$("$CODEX_LOCAL_BIN_DIR/omo" --version 2>&1)') &&
      smokeStep.includes('[ "$omo_version_output" = "$OMO_VERSION" ]') &&
      smokeStep.includes('ulw_loop_output=$("$CODEX_LOCAL_BIN_DIR/omo" ulw-loop --help 2>&1)') &&
      smokeStep.includes('printf "%s" "$ulw_loop_output" | grep -q "ulw-loop"')

    // #then
    expect(smokeRunsAfterPublishBeforeRestore, "post-publish smoke must run after lazycodex publish and before package restore").toBe(true)
    expect(smokesReleaseVersion, "post-publish smoke must verify the exact release version").toBe(true)
    expect(smokesStableLatestOnly, "post-publish smoke must verify latest only for stable releases").toBe(true)
    expect(retriesRegistryPropagation, "post-publish smoke must tolerate npm registry propagation").toBe(true)
    expect(isolatesCodexState, "post-publish smoke must isolate HOME and Codex paths").toBe(true)
    expect(assertsDryRunRouting, "post-publish smoke must assert the expected dry-run routing output").toBe(true)
    expect(
      installsRealPackageAndVerifiesOmoBin,
      "post-publish smoke must run a real install and verify the omo runtime wrapper exists, reports the release version, and executes ulw-loop",
    ).toBe(true)
  })

  test("builds the Codex plugin components in publish-main before any package that ships the plugin tree", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")

    // #when
    const installDepsIndex = publishMainJob.indexOf("npm --prefix packages/omo-codex/plugin ci")
    const buildComponentsIndex = publishMainJob.indexOf("bun run --cwd packages/omo-codex/plugin build")
    const opencodePublishIndex = publishMainJob.indexOf("name: Publish oh-my-opencode")
    const openagentPublishIndex = publishMainJob.indexOf("name: Publish oh-my-openagent")
    const lazycodexPublishIndex = publishMainJob.indexOf("name: Publish lazycodex-ai")
    const buildStepStart = publishMainJob.indexOf("name: Build Codex plugin components")
    const buildStepSection =
      buildStepStart >= 0 ? publishMainJob.slice(buildStepStart, publishMainJob.indexOf("- name:", buildStepStart + 1)) : ""

    const buildsPluginComponents = buildComponentsIndex >= 0
    const installsPluginDepsBeforeBuild =
      installDepsIndex >= 0 && buildComponentsIndex >= 0 && installDepsIndex < buildComponentsIndex
    // oh-my-opencode/oh-my-openagent tarballs feed the lazycodex plugin cache, so packing
    // them before the component build ships source-only hooks (lazycodex#45, 4.8.1).
    const buildsBeforeOpencodePublish =
      buildComponentsIndex >= 0 && opencodePublishIndex > buildComponentsIndex
    const buildsBeforeOpenagentPublish =
      buildComponentsIndex >= 0 && openagentPublishIndex > buildComponentsIndex
    const buildsBeforeLazycodexPublish =
      buildComponentsIndex >= 0 && lazycodexPublishIndex > buildComponentsIndex
    const buildStepRunsForEveryPluginShippingPackage =
      buildStepSection.includes("steps.check.outputs.skip != 'true'") &&
      buildStepSection.includes("steps.check-openagent.outputs.skip != 'true'") &&
      buildStepSection.includes("inputs.publish_lazycodex == true && steps.check-lazycodex.outputs.skip != 'true'")
    const metadataStampIndex = publishMainJob.indexOf("jq --arg v \"$VERSION\" '.version = $v' packages/omo-codex/plugin/.codex-plugin/plugin.json")
    const stampsMetadataBeforeBuild =
      metadataStampIndex >= 0 && buildComponentsIndex >= 0 && metadataStampIndex < buildComponentsIndex

    // #then
    expect(buildsPluginComponents, "publish-main must build the Codex plugin components so published tarballs ship compiled dist (B1)").toBe(true)
    expect(installsPluginDepsBeforeBuild, "publish-main must install nested Codex plugin deps before building the components").toBe(true)
    expect(stampsMetadataBeforeBuild, "publish-main must stamp the Codex plugin release version before building status messages").toBe(true)
    expect(buildsBeforeOpencodePublish, "Codex plugin components must be built before the oh-my-opencode npm publish step").toBe(true)
    expect(buildsBeforeOpenagentPublish, "Codex plugin components must be built before the oh-my-openagent npm publish step").toBe(true)
    expect(buildsBeforeLazycodexPublish, "Codex plugin components must be built before the lazycodex-ai npm publish step").toBe(true)
    expect(buildStepRunsForEveryPluginShippingPackage, "plugin component build must run whenever any plugin-shipping package publishes").toBe(true)
  })

})
