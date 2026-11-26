import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { type GitPort, offenderBaseProblems, probeBase, registryBaseProblems } from "./base-probe"
import { type Baseline, ORIGINAL_PATH, PIN_PATH, UNRESOLVED_PATH } from "./baseline"
import { allRows, loadDomainFiles, REPO_ROOT } from "./registry"

// The probe decides whether the base-tree checks run (design lane ruling on review 6064044043). Both directions are
// tested with a fake git port, so a skip can never pass silently: readable means the checks run and can fail; not
// readable means skipped with the stated reason.

const file = (path: string): string => readFileSync(join(REPO_ROOT, path), "utf8")
const unresolved = JSON.parse(file(UNRESOLVED_PATH)) as Baseline
const head = {
  rows: allRows(loadDomainFiles()),
  originalText: file(ORIGINAL_PATH),
  pinText: file(PIN_PATH),
  unresolved,
  evidence: [],
}

// A checkout that has the base: merge-base answers it, its tree exists, and show answers the base's files.
const readable =
  (files: Readonly<Record<string, string>>): GitPort =>
  (args) => {
    if (args[0] === "merge-base") return "b".repeat(40) + "\n"
    if (args[0] === "cat-file") return ""
    const path = String(args[1]).split(":")[1] ?? ""
    if (files[path] === undefined) throw new Error(`fatal: path '${path}' does not exist`)
    return files[path]
  }
const shallow: GitPort = () => {
  throw new Error("fatal: Not a valid object name origin/dev")
}

describe("the merge-base probe and the checks it gates", () => {
  test("#given a shallow checkout without the base ref #then the probe says so and both checks are skipped with that reason", () => {
    const probe = probeBase(shallow, "origin/dev")
    expect(probe).toEqual({
      readable: false,
      reason:
        "no merge base of origin/dev and HEAD in this checkout (a shallow clone without origin/dev); the SDK Parity job runs this check with full history",
    })
    expect(registryBaseProblems(shallow, head, "origin/dev")).toEqual({ skipped: probe.readable ? "" : probe.reason })
    expect(offenderBaseProblems(shallow, {}, "origin/dev")).toEqual({ skipped: probe.readable ? "" : probe.reason })
  })

  test("#given a merge base whose tree is missing #then the probe names the base", () => {
    const noTree: GitPort = (args) => {
      if (args[0] === "merge-base") return "c".repeat(40)
      throw new Error("fatal: not a valid object")
    }
    expect(probeBase(noTree, "origin/dev")).toEqual({
      readable: false,
      reason: "the merge base cccccccccc has no tree in this checkout",
    })
  })

  test("#given a readable base whose manifest had cleared an entry the head restores #then the registry check runs and fails", () => {
    const [first, ...rest] = unresolved.entries
    if (first === undefined) throw new Error("no unresolved entry")
    const files = {
      [ORIGINAL_PATH]: head.originalText,
      [PIN_PATH]: head.pinText,
      [UNRESOLVED_PATH]: JSON.stringify({ ...unresolved, entries: rest }),
    }
    const check = registryBaseProblems(readable(files), head, "origin/dev")
    expect(check).toEqual({
      problems: [expect.stringContaining(`restores ${first.id}, which the merge base had cleared`)],
    })
  })

  test("#given a readable base whose offender record a file has since grown past #then the offender check runs and fails", () => {
    const base = { "a.ts": { uses: ["L1"] } }
    const check = offenderBaseProblems(
      readable({ "script/remote-import-guard-adapter-offenders.json": JSON.stringify(base) }),
      { "a.ts": { uses: ["L1", "L2"] } },
      "origin/dev",
    )
    expect(check).toEqual({
      problems: ["a.ts gained L2, which the merge base's record does not list; route it through the SDK"],
    })
  })
})
