import { describe, expect, test } from "bun:test"

import { type GitReader, gitTrees } from "./remote-import-guard-git-trees"
import { type MoveSet, movedFileReport } from "./remote-import-guard-moves"

// Architecture contract (#14364, design lane ruling on review 6065783034): the moved-file check fails closed when the
// checkout lacks an object it needs, naming the fetch, instead of reading the file as absent; a failed importer search is
// never read as "imported by nothing" (review 6066135750).

const from = "packages/omo-opencode/src/cli/service-auth/a.ts"
const to = "packages/account-core/src/a.ts"
const set: MoveSet = { commit: "c".repeat(40), pairs: { [from]: to } }
const base = "d".repeat(40)
const listing =
  (head: readonly string[], baseFiles: readonly string[] | undefined): GitReader =>
  (args) =>
    args[0] !== "ls-tree" ? undefined : args.includes("HEAD") ? head.join("\n") : baseFiles?.join("\n")

describe("the moved-file trees", () => {
  test("#given a merge base whose tree this checkout cannot list #then the report fails closed naming the fetch", () => {
    const trees = gitTrees(listing([to], undefined), base, "/repo", () => [], {
      batch: () => new Map([[`HEAD:${to}`, "x"]]),
    })
    expect(movedFileReport(set, trees).problems[0]).toBe(
      `the tree of ${base} is not in this checkout: fetch it (git fetch origin ${base})`,
    )
  })

  test("#given a listed base file whose blob cannot be read (a blob-filtered clone) #then it fails closed naming the fetch", () => {
    const trees = gitTrees(listing([to], [from]), base, "/repo", () => [], {
      batch: () => new Map([[`HEAD:${to}`, "x"]]),
    })
    expect(movedFileReport(set, trees).problems[0]).toBe(
      `${base}:${from} is listed but cannot be read: fetch its blobs (git fetch origin ${base})`,
    )
  })

  test("#given every object present #then nothing is missing and the moved file is judged on its content", () => {
    const blobs = new Map([
      [`HEAD:${to}`, "export const a = 1\n"],
      [`${base}:${from}`, "export const a = 1\n"],
    ])
    const trees = gitTrees(listing([to], [from]), base, "/repo", () => [], { batch: () => blobs })
    expect(movedFileReport(set, trees)).toEqual({ problems: [], hops: [], exempt: [] })
  })

  test("#given the importer search itself failing #then an exempt-shaped file is not exempt and the check fails closed", () => {
    const own = "packages/account-core/src/own.test.ts"
    const trees = gitTrees(listing([own], []), base, "/repo", () => [], {
      batch: () => new Map(),
      search: () => undefined,
    })
    const report = movedFileReport(set, trees)
    expect(report.exempt).toEqual([])
    expect(report.problems[0]).toBe(`the importer search at HEAD for ${own} failed, so it cannot be shown unreachable`)
  })

  test("#given an importer search that succeeds with no match #then the same file is exempt", () => {
    const own = "packages/account-core/src/own.test.ts"
    const trees = gitTrees(listing([own], []), base, "/repo", () => [], { batch: () => new Map(), search: () => [] })
    expect(movedFileReport(set, trees)).toEqual({ problems: [], hops: [], exempt: [own] })
  })
})
