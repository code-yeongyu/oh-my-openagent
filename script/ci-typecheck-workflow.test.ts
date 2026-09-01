/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

const ciWorkflowPath = new URL("../.github/workflows/ci.yml", import.meta.url)

function sliceWorkflowSection(workflow: string, startMarker: string, endMarker: string): string {
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker, start)
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`missing workflow section between ${startMarker} and ${endMarker}`)
  }
  return workflow.slice(start, end)
}

describe("CI typecheck workflow", () => {
  test("#given root typecheck includes script tooling #when CI typecheck job is inspected #then script tooling is not rerun as a duplicate step", () => {
    // given
    const workflow = readFileSync(ciWorkflowPath, "utf8")
    const typecheckJob = sliceWorkflowSection(workflow, "  typecheck:", "  codex-compatibility:")

    // when
    const rootTypecheckStepCount = (typecheckJob.match(/run: bun run typecheck$/gm) ?? []).length
    const duplicateScriptTypecheckStepCount = (typecheckJob.match(/run: bun run typecheck:script$/gm) ?? []).length

    // then
    expect(rootTypecheckStepCount, "CI typecheck job must keep the root typecheck command").toBe(1)
    expect(duplicateScriptTypecheckStepCount, "root typecheck already runs typecheck:script").toBe(0)
  })
})
