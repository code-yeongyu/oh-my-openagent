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
    const lspBuildIndex = syncStep.indexOf("bun run build:lsp-tools-mcp")
    const codexPluginBuildIndex = syncStep.indexOf("bun run --cwd packages/omo-codex/plugin build")
    const syncScriptIndex = syncStep.indexOf("bun run script/sync-lazycodex-marketplace.ts")
    const buildsMcpDistsBeforeCodexPlugin =
      astGrepBuildIndex >= 0 &&
      lspBuildIndex >= 0 &&
      codexPluginBuildIndex >= 0 &&
      astGrepBuildIndex < codexPluginBuildIndex &&
      lspBuildIndex < codexPluginBuildIndex
    const buildsCodexPluginBeforeMarketplaceSync =
      codexPluginBuildIndex >= 0 && syncScriptIndex > codexPluginBuildIndex

    // #then
    expect(
      buildsMcpDistsBeforeCodexPlugin,
      "release marketplace sync must build bundled MCP dists before the Codex plugin build consumes them",
    ).toBe(true)
    expect(buildsCodexPluginBeforeMarketplaceSync, "release marketplace sync must build the Codex plugin before copying it").toBe(true)
  })

  test("initializes the LSP tools submodule before the release marketplace sync builds it", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const syncStep = sliceWorkflowSection(
      workflow,
      "      - name: Sync LazyCodex Codex marketplace",
      "      - name: Resolve LazyCodex release payload",
    )

    // #when
    const submoduleUpdateIndex = syncStep.indexOf("git submodule update --init --recursive packages/lsp-tools-mcp")
    const lspBuildIndex = syncStep.indexOf("bun run build:lsp-tools-mcp")
    const initializesSubmoduleBeforeBuild =
      submoduleUpdateIndex >= 0 && lspBuildIndex > submoduleUpdateIndex

    // #then
    expect(
      initializesSubmoduleBeforeBuild,
      "release marketplace sync must initialize packages/lsp-tools-mcp before npm ci runs inside it",
    ).toBe(true)
  })
})
