/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { findMissingPayloadPaths, requiredCodexInstallPaths } from "./npm-payload-required-paths.mjs"

const canonicalCodexPromptPath = "packages/prompts-core/prompts/ultrawork/codex.md"
const lspCorePaths = ["packages/lsp-core/package.json", "packages/lsp-core/src/index.ts"]

describe("npm payload required paths", () => {
  test("#given the Codex install requirements #when they are resolved #then the canonical prompt is required with posix separators", () => {
    // given / when
    const required = requiredCodexInstallPaths()

    // then
    expect(required).toContain(canonicalCodexPromptPath)
  })

  test("#given a payload without the canonical prompt #when it is checked #then the missing path is reported", () => {
    // given
    const packedPaths = ["package.json", "packages/shared-skills/index.mjs"]

    // when
    const missing = findMissingPayloadPaths(packedPaths, requiredCodexInstallPaths())

    // then
    expect(missing).toEqual([canonicalCodexPromptPath, ...lspCorePaths])
  })

  test("#given a payload carrying the canonical prompt #when it is checked #then nothing is reported", () => {
    // given
    const packedPaths = ["package.json", canonicalCodexPromptPath, ...lspCorePaths]

    // when
    const missing = findMissingPayloadPaths(packedPaths, requiredCodexInstallPaths())

    // then
    expect(missing).toEqual([])
  })

  test("Codex payload rejects a missing local LSP dependency before npm creates a dangling package link", () => {
    expect(findMissingPayloadPaths([canonicalCodexPromptPath], requiredCodexInstallPaths())).toEqual(lspCorePaths)
  })

  test("direct Codex publish manifest includes the local LSP package and source tree", () => {
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")
    const filesMatch = workflow.slice(workflow.indexOf("- name: Publish lazycodex-ai")).match(/\.files = (\[[^\n]+\])/)
    if (!filesMatch?.[1]) throw new Error("direct Codex package files manifest not found")
    const files: string[] = JSON.parse(filesMatch[1])
    expect(files).toContain("packages/lsp-core/package.json")
    expect(files).toContain("packages/lsp-core/src")
  })
})
