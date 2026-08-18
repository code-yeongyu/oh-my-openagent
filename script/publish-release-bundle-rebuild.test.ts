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

describe("test workflows", () => {
  test("retries release-state PR reads and writes on transient GitHub API errors", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareJob = sliceWorkflowSection(workflow, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")

    // #when
    const definesRetry = prepareJob.includes("retry_gh()")
    const retriesPrList = prepareJob.includes('PR_NUMBER="$(retry_gh "List release-state PR" gh pr list')
    const retriesPrState = prepareJob.includes('PR_STATE="$(retry_gh "Read release-state PR state" gh pr view')
    const retriesCheckRollup = prepareJob.includes('FAILURES="$(retry_gh "Read release-state PR checks" gh pr view')
    const retriesPrCreate = prepareJob.includes("create_release_pr()") && prepareJob.includes("gh pr create")
    const retriesAutoMerge = prepareJob.includes("enable_release_auto_merge()") && prepareJob.includes("gh pr merge")

    // #then
    expect(definesRetry, "prepare-release-state must centralize retry handling for GitHub PR reads").toBe(true)
    expect(retriesPrList, "a transient 503 while listing the existing release PR must not kill publish").toBe(true)
    expect(retriesPrState, "a transient 503 while reading merge state must not kill publish").toBe(true)
    expect(retriesCheckRollup, "a transient 503 while reading check rollup must not kill publish").toBe(true)
    expect(retriesPrCreate, "a transient create response failure must recover the created release PR").toBe(true)
    expect(retriesAutoMerge, "a transient auto-merge response failure must verify whether auto-merge was enabled").toBe(true)
  })

  test("rebuilds version-stamped Senpi bundles into the release commit", () => {
    // #given
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareJob = sliceWorkflowSection(workflow, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")

    // #when
    const rebuildsBundles = prepareJob.includes("node packages/omo-senpi/plugin/scripts/build-extension.mjs")
    const stagesBundles = prepareJob.includes("git add -f packages/omo-senpi/plugin/extensions")
    const rebuildPrecedesCommit =
      prepareJob.indexOf("node packages/omo-senpi/plugin/scripts/build-extension.mjs") <
      prepareJob.indexOf('git commit -m "release: v${VERSION}"')

    // #then
    expect(rebuildsBundles, "the version bump restamps OMO_SENPI_PACKAGE_VERSION, so the release commit must rebuild the Senpi bundles").toBe(true)
    expect(stagesBundles, "rebuilt bundles live in an ignored path and must be force-staged into the release commit").toBe(true)
    expect(rebuildPrecedesCommit, "the rebuild must land in the release commit, not after it").toBe(true)
  })
})
