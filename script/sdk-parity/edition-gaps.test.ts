import { describe, expect, test } from "bun:test"

import { EDITION_GAPS, type EditionGap, editionGapProblems } from "./edition-gaps"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"

// The edition-gap record (slice C1c, #14960): the list holds today, and each way an entry can be wrong fails it.

const rows = allRows(loadDomainFiles())
const [gap] = EDITION_GAPS
if (gap === undefined) throw new Error("edition-gaps.json lists no gap")
const problems = (entry: EditionGap): string => editionGapProblems([entry], rows, REPO_ROOT).join("\n")

describe("edition gaps", () => {
  test("#given the recorded gaps #then each one's evidence still holds", () => {
    expect(editionGapProblems(EDITION_GAPS, rows, REPO_ROOT)).toEqual([])
  })

  test("#given a gap on a row the registry does not have #then it fails", () => {
    expect(problems({ ...gap, row: "install.nowhere" })).toContain("no registry row install.nowhere")
  })

  test("#given an edition outside the closed set #then it fails", () => {
    expect(problems({ ...gap, edition: "desktop" })).toContain("desktop is not an edition (npm, compiled)")
  })

  test("#given evidence that never existed #then it fails", () => {
    expect(
      problems({ ...gap, evidence: { ...gap.evidence, module: "packages/omo-native/no-such-module.ts" } }),
    ).toContain("packages/omo-native/no-such-module.ts, which does not exist")
  })

  test("#given an entry module that no longer reaches the evidence #then the entry is stale", () => {
    expect(
      problems({ ...gap, evidence: { ...gap.evidence, entry: "packages/omo-native/bin/lib/fatal.js" } }),
    ).toContain("stale, packages/omo-native/bin/lib/fatal.js no longer reaches packages/omo-native/compiled-update.ts")
  })

  test("#given a module that no longer calls the function #then the entry is stale", () => {
    expect(problems({ ...gap, evidence: { ...gap.evidence, calls: "compiledInstallUpdateGone" } })).toContain(
      "no longer calls compiledInstallUpdateGone",
    )
  })
})
