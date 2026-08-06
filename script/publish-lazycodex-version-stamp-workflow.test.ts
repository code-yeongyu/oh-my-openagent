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

describe("LazyCodex release version stamping workflow", () => {
  test("stamps hook status messages with the release version before publishing lazycodex-ai", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const buildStep = sliceWorkflowSection(
      workflow,
      "      - name: Build Codex plugin components",
      "      - name: Publish lazycodex-ai",
    )

    // #when
    const exportsReleaseVersionForHookBuild = buildStep.includes("LAZYCODEX_RELEASE_VERSION: ${{ needs.release-metadata.outputs.version }}")

    // #then
    expect(exportsReleaseVersionForHookBuild, "lazycodex npm build must pass the release version into hook status message generation").toBe(true)
  })

  test("stamps hook status messages with the release version before syncing the LazyCodex repository", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const syncStep = sliceWorkflowSection(
      workflow,
      "      - name: Sync LazyCodex Codex marketplace",
      "      - name: Resolve LazyCodex release payload",
    )

    // #when
    const exportsReleaseVersionForRepoSync = syncStep.includes("LAZYCODEX_RELEASE_VERSION: ${{ needs.release-metadata.outputs.version }}")

    // #then
    expect(exportsReleaseVersionForRepoSync, "lazycodex repository sync must pass the release version into copied plugin metadata").toBe(true)
  })
})
