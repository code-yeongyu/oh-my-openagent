import { describe, expect, test } from "bun:test"

import { type GitReader, gitTrees } from "./remote-import-guard-git-trees"
import { type MoveSet, movedFileReport } from "./remote-import-guard-moves"

// Architecture contract (#14364, design lane ruling on review 6065783034): the moved-file check fails closed when the
// checkout lacks an object it needs, naming the fetch, instead of reading the file as absent.

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
    const trees = gitTrees(
      listing([to], undefined),
      base,
      "/repo",
      () => [],
      () => new Map([[`HEAD:${to}`, "x"]]),
    )
    expect(movedFileReport(set, trees).problems[0]).toBe(
      `the tree of ${base} is not in this checkout: fetch it (git fetch origin ${base})`,
    )
  })

  test("#given a listed base file whose blob cannot be read (a blob-filtered clone) #then it fails closed naming the fetch", () => {
    const trees = gitTrees(
      listing([to], [from]),
      base,
      "/repo",
      () => [],
      () => new Map([[`HEAD:${to}`, "x"]]),
    )
    expect(movedFileReport(set, trees).problems[0]).toBe(
      `${base}:${from} is listed but cannot be read: fetch its blobs (git fetch origin ${base})`,
    )
  })

  test("#given every object present #then nothing is missing and the moved file is judged on its content", () => {
    const blobs = new Map([
      [`HEAD:${to}`, "export const a = 1\n"],
      [`${base}:${from}`, "export const a = 1\n"],
    ])
    const trees = gitTrees(
      listing([to], [from]),
      base,
      "/repo",
      () => [],
      () => blobs,
    )
    expect(movedFileReport(set, trees)).toEqual({ problems: [], hops: [], exempt: [] })
  })
})
