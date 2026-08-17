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

function sliceWorkflowSectionToEnd(workflow: string, startMarker: string): string {
  const start = workflow.indexOf(startMarker)
  if (start < 0) throw new Error(`missing workflow section starting at ${startMarker}`)
  return workflow.slice(start)
}

const skippedResultCondition = (job: string): string =>
  `contains(fromJSON('["success","skipped"]'), needs.${job}.result)`

describe("publish gate reuse", () => {
  test("exposes a fail-closed gate reuse decision before release gates", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const gateReuseJob = sliceWorkflowSection(workflow, "  gate-reuse:", "  test:")

    expect(gateReuseJob).toContain("runs-on: ubuntu-latest")
    expect(gateReuseJob).toContain("skip_gates: ${{ steps.reuse.outputs.skip_gates }}")
    expect(gateReuseJob).toContain("PREPARED_RELEASE_SHA: ${{ inputs.prepared_release_sha }}")
    expect(gateReuseJob).toContain('if [ -z "$PREPARED_RELEASE_SHA" ]')
    expect(gateReuseJob).toContain('echo "skip_gates=true" >> "$GITHUB_OUTPUT"')
    expect(gateReuseJob).toContain("gh api")
    expect(gateReuseJob).toContain("commits/${PREPARED_RELEASE_SHA}/check-runs")
    expect(gateReuseJob).toContain("--paginate")
    for (const checkName of [
      "test",
      "typecheck",
      "codex-compatibility (ubuntu-latest)",
      "codex-compatibility (macos-latest)",
      "codex-compatibility (windows-latest)",
    ]) {
      expect(gateReuseJob).toContain(checkName)
    }
    expect(gateReuseJob).toContain('all(.conclusion == "success")')
    expect(gateReuseJob).toContain("set -euo pipefail")
    expect(gateReuseJob).not.toContain("continue-on-error")
    expect(gateReuseJob).not.toContain("|| true")
    expect(gateReuseJob).toContain("name: Write job summary")
    expect(gateReuseJob).toContain(".github/scripts/write-job-summary.sh")
  })

  test("skips each release gate only when gate reuse says checks are reusable", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const testJob = sliceWorkflowSection(workflow, "  test:", "  typecheck:")
    const typecheckJob = sliceWorkflowSection(workflow, "  typecheck:", "  codex-compatibility:")
    const codexJob = sliceWorkflowSection(workflow, "  codex-compatibility:", "  preflight-trust:")

    for (const job of [testJob, typecheckJob, codexJob]) {
      expect(job).toContain("needs: [gate-reuse]")
      expect(job).toContain("if: needs.gate-reuse.outputs.skip_gates != 'true'")
    }
  })

  test("accepts skipped reusable gates while requiring gate-reuse itself to succeed", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const prepareJob = sliceWorkflowSection(workflow, "  prepare-release-state:", "  dispatch-provenance-safe-publish:")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")
    const publishPlatformJob = sliceWorkflowSection(workflow, "  publish-platform:", "  release:")

    for (const job of [prepareJob, publishMainJob, publishPlatformJob]) {
      expect(job).toContain("gate-reuse")
      expect(job).toContain("needs.gate-reuse.result == 'success'")
      expect(job).toContain(skippedResultCondition("test"))
      expect(job).toContain(skippedResultCondition("typecheck"))
      expect(job).toContain(skippedResultCondition("codex-compatibility"))
    }
  })

  test("keeps every publication surface pinned to a prepared release SHA", () => {
    const workflow = readFileSync(publishWorkflowPath, "utf8")
    const publishMainJob = sliceWorkflowSection(workflow, "  publish-main:", "  publish-platform:")
    const publishPlatformJob = sliceWorkflowSection(workflow, "  publish-platform:", "  release:")
    const releaseJob = sliceWorkflowSectionToEnd(workflow, "  release:")

    expect(publishMainJob).toContain("inputs.prepared_release_sha != ''")
    expect(publishPlatformJob).toContain("inputs.prepared_release_sha != ''")
    expect(releaseJob).toContain("inputs.prepared_release_sha != ''")
  })
})
