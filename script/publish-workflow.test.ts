/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

const workflowChecks = [
  {
    path: ciWorkflowPath,
    testRuns: [
      "run: bun test",
      "run: bun test src/shared/dist-bundle-bun-globals.test.ts",
    ],
  },
  {
    path: new URL("../.github/workflows/publish.yml", import.meta.url),
    testRuns: ["run: bun test"],
  },
]

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

  test("syncs the LazyCodex Codex marketplace bundle during release", () => {
    // #given
    const workflow = readFileSync(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8")

    // #when
    const appliesCodexPluginVersion = workflow.includes("packages/omo-codex/plugin/.codex-plugin/plugin.json")
    const syncsLazycodexMarketplace = workflow.includes("bun run script/sync-lazycodex-marketplace.ts")
    const pushesLazycodexMarketplace = workflow.includes("code-yeongyu/lazycodex")
    const requiresLazycodexSyncToken = workflow.includes("secrets.LAZYCODEX_SYNC_TOKEN == ''") &&
      workflow.includes("token: ${{ secrets.LAZYCODEX_SYNC_TOKEN }}")

    // #then
    expect(appliesCodexPluginVersion, "release must version the Codex plugin manifest before marketplace sync").toBe(true)
    expect(syncsLazycodexMarketplace, "release must sync the LazyCodex marketplace bundle").toBe(true)
    expect(pushesLazycodexMarketplace, "release must target the LazyCodex repository").toBe(true)
    expect(requiresLazycodexSyncToken, "release must require a cross-repo token for LazyCodex push").toBe(true)
  })
})
