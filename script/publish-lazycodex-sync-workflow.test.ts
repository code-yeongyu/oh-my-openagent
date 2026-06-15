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

describe("LazyCodex marketplace sync workflow", () => {
  test("builds bundled MCP dists before the release marketplace sync builds the Codex plugin", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const syncStep = sliceWorkflowSection(
      workflow,
      "      - name: Sync LazyCodex Codex marketplace",
      "      - name: Resolve LazyCodex release payload",
    )

    // #when
    const astGrepBuildIndex = syncStep.indexOf("bun run build:ast-grep-mcp")
    const gitBashBuildIndex = syncStep.indexOf("bun run build:git-bash-mcp")
    const lspBuildIndex = syncStep.indexOf("bun run build:lsp-tools-mcp")
    const lspDaemonBuildIndex = syncStep.indexOf("bun run build:lsp-daemon")
    const codexPluginBuildIndex = syncStep.indexOf("bun run --cwd packages/omo-codex/plugin build")
    const syncScriptIndex = syncStep.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const buildsMcpDistsBeforeCodexPlugin =
      astGrepBuildIndex >= 0 &&
      gitBashBuildIndex >= 0 &&
      lspBuildIndex >= 0 &&
      lspDaemonBuildIndex >= 0 &&
      codexPluginBuildIndex >= 0 &&
      astGrepBuildIndex < codexPluginBuildIndex &&
      gitBashBuildIndex < codexPluginBuildIndex &&
      lspBuildIndex < codexPluginBuildIndex &&
      lspDaemonBuildIndex < codexPluginBuildIndex
    const buildsCodexPluginBeforeMarketplaceSync =
      codexPluginBuildIndex >= 0 && syncScriptIndex > codexPluginBuildIndex

    // #then
    expect(
      buildsMcpDistsBeforeCodexPlugin,
      "release marketplace sync must build bundled MCP dists before the Codex plugin build consumes them",
    ).toBe(true)
    expect(buildsCodexPluginBeforeMarketplaceSync, "release marketplace sync must build the Codex plugin before copying it").toBe(true)
  })

  test("uses the vendored LSP tools package directly during release marketplace sync", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const syncStep = sliceWorkflowSection(
      workflow,
      "      - name: Sync LazyCodex Codex marketplace",
      "      - name: Resolve LazyCodex release payload",
    )

    // #when
    const gitBashBuildIndex = syncStep.indexOf("bun run build:git-bash-mcp")
    const lspBuildIndex = syncStep.indexOf("bun run build:lsp-tools-mcp")
    const lspDaemonBuildIndex = syncStep.indexOf("bun run build:lsp-daemon")

    // #then
    expect(syncStep).not.toContain("git submodule")
    expect(gitBashBuildIndex, "release marketplace sync must build the vendored Git Bash MCP package").toBeGreaterThanOrEqual(0)
    expect(lspBuildIndex, "release marketplace sync must build the vendored LSP package").toBeGreaterThanOrEqual(0)
    expect(lspDaemonBuildIndex, "release marketplace sync must build the vendored LSP daemon package").toBeGreaterThanOrEqual(0)
  })

  test("stages generated LazyCodex repository workflow changes", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const syncStep = sliceWorkflowSection(
      workflow,
      "      - name: Sync LazyCodex Codex marketplace",
      "      - name: Resolve LazyCodex release payload",
    )

    // #when
    const stagesWorkflow = syncStep.includes("git add .agents/plugins/marketplace.json .github/workflows/pr-source-guidance.yml plugins/omo")

    // #then
    expect(stagesWorkflow, "release marketplace sync must stage generated LazyCodex repository workflow changes").toBe(true)
  })
})
