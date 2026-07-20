/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const packageManifestPath = new URL("../package.json", import.meta.url)

describe("Codex compatibility test script", () => {
  test("runs the vendored LSP package tests after building its package", () => {
    // #given
    const packageManifest = readFileSync(packageManifestPath, "utf8")

    // #when
    const lspBuildIndex = packageManifest.indexOf("bun run build:lsp-tools-mcp")
    const lspTestIndex = packageManifest.indexOf("npm --prefix packages/lsp-tools-mcp test")
    const testsLspAfterBuild = lspBuildIndex >= 0 && lspTestIndex > lspBuildIndex

    // #then
    expect(testsLspAfterBuild, "test:codex must run the vendored LSP package test suite after building it").toBe(true)
  })

  test("runs the CodeGraph component tests before packaged Codex checks", () => {
    // #given
    const packageManifest = readFileSync(packageManifestPath, "utf8")

    // #when
    const pluginBuildIndex = packageManifest.indexOf("bun run --cwd packages/omo-codex/plugin build")
    const codegraphTestIndex = packageManifest.indexOf("npm --prefix packages/omo-codex/plugin/components/codegraph test")
    const noticesIndex = packageManifest.indexOf("node scripts/check-third-party-notices.mjs --ship")
    const testsCodegraphBeforePackagedChecks =
      pluginBuildIndex >= 0 &&
      codegraphTestIndex > pluginBuildIndex &&
      noticesIndex > codegraphTestIndex

    // #then
    expect(
      testsCodegraphBeforePackagedChecks,
      "test:codex must run the CodeGraph component test suite before packaged Codex checks",
    ).toBe(true)
  })

  test("builds lsp-daemon before installer tests copy packaged runtimes", () => {
    // #given
    const testCodexScript = JSON.parse(readFileSync(packageManifestPath, "utf8")).scripts?.["test:codex"] ?? ""

    // #when
    const lspDaemonBuildIndex = testCodexScript.indexOf("bun run build:lsp-daemon")
    const pluginBuildIndex = testCodexScript.indexOf("bun run --cwd packages/omo-codex/plugin build")
    const installerTestIndex = testCodexScript.indexOf("packages/omo-codex/src/install/install-codex-packaged.test.ts")
    const buildsLspDaemonBeforePluginAndInstallerTests =
      lspDaemonBuildIndex >= 0 &&
      pluginBuildIndex > lspDaemonBuildIndex &&
      installerTestIndex > lspDaemonBuildIndex

    // #then
    expect(
      buildsLspDaemonBeforePluginAndInstallerTests,
      "test:codex must build lsp-daemon before plugin build and installer tests assert packaged runtime files",
    ).toBe(true)
  })

  test("builds git-bash MCP before installer tests copy packaged runtimes", () => {
    // #given
    const testCodexScript = JSON.parse(readFileSync(packageManifestPath, "utf8")).scripts?.["test:codex"] ?? ""

    // #when
    const gitBashBuildIndex = testCodexScript.indexOf("bun run build:git-bash-mcp")
    const installerTestIndex = testCodexScript.indexOf("packages/omo-codex/src/install/install-codex-packaged.test.ts")
    const buildsGitBashBeforeInstallerTests = gitBashBuildIndex >= 0 && installerTestIndex > gitBashBuildIndex

    // #then
    expect(
      buildsGitBashBeforeInstallerTests,
      "test:codex must build git-bash-mcp before installer tests assert packaged runtime files",
    ).toBe(true)
  })
})
