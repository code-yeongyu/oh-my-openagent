/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const packageManifestPath = new URL("../package.json", import.meta.url)

describe("Codex compatibility test script", () => {
  test("does not run the rejected compatibility installer test", () => {
    // #given
    const packageManifest = readFileSync(packageManifestPath, "utf8")
    const forbiddenShortToken = ["o", "m", "x"].join("")
    const forbiddenInstallerTest = ["install", forbiddenShortToken, "compatibility.test.mjs"].join("-")

    // #when
    const hasForbiddenShortToken = packageManifest.toLowerCase().includes(forbiddenShortToken)
    const hasForbiddenInstallerTest = packageManifest.includes(forbiddenInstallerTest)

    // #then
    expect(hasForbiddenShortToken, "test:codex must not include the rejected compatibility token").toBe(false)
    expect(hasForbiddenInstallerTest, "test:codex must not include the rejected installer test").toBe(false)
  })

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

  test("builds lsp-daemon before installer tests copy packaged runtimes", () => {
    // #given
    const packageManifest = readFileSync(packageManifestPath, "utf8")

    // #when
    const lspDaemonBuildIndex = packageManifest.indexOf("bun run build:lsp-daemon")
    const pluginBuildIndex = packageManifest.indexOf("bun run --cwd packages/omo-codex/plugin build")
    const installerTestIndex = packageManifest.indexOf("packages/omo-codex/src/install/install-codex-packaged.test.ts")
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
    const packageManifest = readFileSync(packageManifestPath, "utf8")

    // #when
    const gitBashBuildIndex = packageManifest.indexOf("bun run build:git-bash-mcp")
    const installerTestIndex = packageManifest.indexOf("packages/omo-codex/src/install/install-codex-packaged.test.ts")
    const buildsGitBashBeforeInstallerTests = gitBashBuildIndex >= 0 && installerTestIndex > gitBashBuildIndex

    // #then
    expect(
      buildsGitBashBeforeInstallerTests,
      "test:codex must build git-bash-mcp before installer tests assert packaged runtime files",
    ).toBe(true)
  })
})
