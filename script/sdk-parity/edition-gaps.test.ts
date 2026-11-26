import { beforeAll, describe, expect, test } from "bun:test"

import { readFileSync } from "node:fs"

import { editionGapBaseProblems, type GitPort } from "./base-probe"
import { cellProblems } from "./cells"
import { EDITION_GAPS, type EditionGap, editionGapAdditionProblems, editionGapProblems } from "./edition-gaps"
import { allRows, loadDomainFiles, REPO_ROOT, TEMPLATE_PATH } from "./registry"

// The edition-gap record (slice C1c, #14960): the list holds today, and each way an entry can be wrong fails it.

const rows = allRows(loadDomainFiles())
const [gap] = EDITION_GAPS
if (gap === undefined) throw new Error("edition-gaps.json lists no gap")
const problems = (entry: EditionGap): string => editionGapProblems([entry], rows, REPO_ROOT).join("\n")

// The entries' import graphs are walked once here (the OpenCode command line's is large); every check below reads the memo.
beforeAll(() => {
  editionGapProblems(EDITION_GAPS, rows, REPO_ROOT)
}, 120_000)

describe("edition gaps", () => {
  test("#given the recorded gaps #then each one's evidence still holds", () => {
    expect(editionGapProblems(EDITION_GAPS, rows, REPO_ROOT)).toEqual([])
  })

  test("#given a gap on a row the registry does not have #then it fails", () => {
    expect(problems({ ...gap, row: "install.nowhere" })).toContain("no registry row install.nowhere")
  })

  test("#given an edition outside the closed set #then it fails", () => {
    expect(problems({ ...gap, edition: "desktop" })).toContain("desktop is not an edition (npm, compiled, opencode)")
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

const opencodeGap = EDITION_GAPS.find((entry) => entry.edition === "opencode")
if (opencodeGap === undefined) throw new Error("edition-gaps.json lists no opencode gap")
const withRow = (id: string, change: Partial<(typeof rows)[number]>) =>
  rows.map((row) => (row.id === id ? { ...row, ...change } : row))

describe("an opencode edition gap", () => {
  test("#given a row with no opencode command line #then the gap names that there is nothing missing", () => {
    expect(editionGapProblems([{ ...opencodeGap, row: "install.update" }], rows, REPO_ROOT).join("\n")).toContain(
      "install.update has no opencode command line",
    )
  })

  test("#given a row that carries no OC slice #then the gap names the missing owner", () => {
    const unowned = withRow(opencodeGap.row, { slices: ["C1c"] })
    expect(editionGapProblems([opencodeGap], unowned, REPO_ROOT).join("\n")).toContain("carries no OC slice")
  })

  test("#given a version command that no longer calls the function #then the opencode entry is stale", () => {
    expect(problems({ ...opencodeGap, evidence: { ...opencodeGap.evidence, calls: "versionGone" } })).toContain(
      "no longer calls versionGone",
    )
  })
})

describe("the 6.11 SDK-today cell of a row with an opencode gap", () => {
  const template = readFileSync(TEMPLATE_PATH, "utf8")
  const files = loadDomainFiles()
  // The native row is cleared: today yes. The 6.11 entry's SDK-today cell is set to the value under test.
  const cleared = (cell: string) =>
    files.map((file) => ({
      ...file,
      rows: file.rows.map((row) => (row.id === opencodeGap.row ? { ...row, today: "yes" as const } : row)),
      tables: file.tables.map((entry) =>
        entry.table.startsWith("6.11") && entry.ids.includes(opencodeGap.row)
          ? { ...entry, cells: entry.cells.map((value) => (/^\*\*(yes|no)\*\*$/.test(value) ? cell : value)) }
          : entry,
      ),
    }))
  const gapped = new Set([opencodeGap.row])

  test("#given the gap open and the 6.11 cell saying yes #then it fails", () => {
    expect(cellProblems(template, cleared("**yes**"), gapped).join("\n")).toContain(
      `${opencodeGap.row} is "no" today, the cell says "yes"`,
    )
  })

  test("#given the gap open and the 6.11 cell saying no #then that cell passes", () => {
    const on611 = cellProblems(template, cleared("**no**"), gapped).filter((problem) =>
      problem.startsWith("table 6.11"),
    )
    expect(on611.join("\n")).not.toContain(`${opencodeGap.row} is`)
  })

  test("#given the gap deleted and the row built #then a 6.11 cell still saying no fails", () => {
    expect(cellProblems(template, cleared("**no**")).join("\n")).toContain(
      `${opencodeGap.row} is "yes" today, the cell says "no"`,
    )
  })
})

describe("an edition gap is added only by the pull request that clears its row", () => {
  const added = { ...opencodeGap, row: "install.version" }

  const none = new Set<string>()

  test("#given a new gap on a row the merge base held unresolved and the head clears #then it passes", () => {
    expect(editionGapAdditionProblems([added], [], new Set(["install.version"]), none)).toEqual([])
  })

  test("#given a new gap on a row the head still holds unresolved #then it fails, naming the rule", () => {
    const open = new Set(["install.version"])
    expect(editionGapAdditionProblems([added], [], open, open)).toEqual([
      "edition gap install.version (opencode): install.version is still unresolved at the head; an edition gap is added only by the pull request that clears its row",
    ])
  })

  test("#given a new gap on a row the merge base had built #then it fails, naming the rule", () => {
    expect(editionGapAdditionProblems([added], [], none, none)).toEqual([
      "edition gap install.version (opencode): install.version was not unresolved at the merge base; an edition gap is added only by the pull request that clears its row",
    ])
  })

  test("#given a gap the merge base already had #then it passes on a built row", () => {
    expect(editionGapAdditionProblems([added], [added], none, none)).toEqual([])
  })

  const baseWith =
    (files: Readonly<Record<string, string>>): GitPort =>
    (args) => {
      if (args[0] === "merge-base") return "b".repeat(40) + "\n"
      if (args[0] === "cat-file") return ""
      const path = String(args[1]).split(":")[1] ?? ""
      if (files[path] === undefined) throw new Error(`fatal: path '${path}' does not exist`)
      return files[path]
    }

  test("#given a readable merge base without the row unresolved #then the base check fails; with it, it passes", () => {
    const unresolved = (ids: readonly string[]) =>
      JSON.stringify({ version: 1, entries: ids.map((id) => ({ id, gap: "no SDK call", slice: "C1c", issue: "new" })) })
    expect(
      editionGapBaseProblems(
        baseWith({ "script/sdk-parity/unresolved.json": unresolved([]) }),
        [added],
        new Set(),
        "origin/dev",
      ),
    ).toEqual({ problems: [expect.stringContaining("an edition gap is added only by the pull request")] })
    expect(
      editionGapBaseProblems(
        baseWith({ "script/sdk-parity/unresolved.json": unresolved(["install.version"]) }),
        [added],
        new Set(),
        "origin/dev",
      ),
    ).toEqual({ problems: [] })
  })
})
