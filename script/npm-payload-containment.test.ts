/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const rootManifestUrl = new URL("../package.json", import.meta.url)
const publishWorkflowUrl = new URL("../.github/workflows/publish.yml", import.meta.url)

function readRootFiles(): readonly string[] {
  const manifest = JSON.parse(readFileSync(rootManifestUrl, "utf8")) as { readonly files?: readonly string[] }
  return manifest.files ?? []
}

describe("root npm payload containment", () => {
  test("#given root files allowlist #when senpi containment is checked #then senpi plugin payload is not shipped", () => {
    // given
    const files = readRootFiles()

    // when / then
    expect(files).not.toContain("packages/omo-senpi/plugin")
    expect(files.some((entry) => entry.startsWith("packages/omo-senpi/"))).toBe(false)
  })

  test("#given root files allowlist #when hygiene negations are checked #then nested node_modules and retired component residue are excluded", () => {
    // given
    const files = readRootFiles()

    // when / then
    expect(files).toContain("!packages/omo-codex/plugin/node_modules")
    expect(files).toContain("!packages/omo-codex/plugin/**/node_modules")
    expect(files).toContain("!packages/omo-codex/plugin/components/workflow-selector")
  })

  test("#given root files allowlist #when vendored MCP shipping is checked #then each ships its package.json alongside dist", () => {
    // given
    const files = readRootFiles()

    // when / then
    for (const vendoredMcp of ["lsp-tools-mcp", "lsp-daemon", "git-bash-mcp"] as const) {
      expect(files).toContain(`packages/${vendoredMcp}/dist`)
      expect(files).toContain(`packages/${vendoredMcp}/package.json`)
    }
  })
})

describe("lazycodex-ai publish payload containment", () => {
  test("#given publish workflow files override #when hygiene negations are checked #then the rewritten files list carries the same exclusions", () => {
    // given
    const workflow = readFileSync(publishWorkflowUrl, "utf8")
    const overrideLine = workflow.split("\n").find((line) => line.includes('.files = ['))

    // when / then
    expect(overrideLine).toBeDefined()
    expect(overrideLine).toContain('"!packages/omo-codex/plugin/node_modules"')
    expect(overrideLine).toContain('"!packages/omo-codex/plugin/**/node_modules"')
    expect(overrideLine).toContain('"!packages/omo-codex/plugin/components/workflow-selector"')
    expect(overrideLine).not.toContain("packages/omo-senpi")
  })

  test("#given publish workflow #when payload guards are checked #then verify-npm-payload runs before both npm publish paths", () => {
    // given
    const workflow = readFileSync(publishWorkflowUrl, "utf8")

    // when
    const guardCount = workflow.split("script/verify-npm-payload.mjs").length - 1

    // then
    expect(guardCount).toBeGreaterThanOrEqual(2)
  })
})
