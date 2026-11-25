import { describe, expect, test } from "bun:test"

import {
  ACCOUNT_CORE_MOVES,
  type GitReader,
  gitTrees,
  type MoveSet,
  movedFileReport,
  moveListProblems,
  type Trees,
} from "./remote-import-guard-moves"
import { probeBase, repoGit } from "./sdk-parity/base-probe"
import { REPO_ROOT } from "./sdk-parity/registry"

// Architecture contract (#14364, the LEAD's ruling on review 6065350035 and the design lane's on the next round): a moved
// layer admits its old offenders only for git's own renames at the pinned move commit, each unchanged apart from module
// specifiers that still name the same module; any other new file reachable from source fails.

const reader: GitReader = (args) => {
  try {
    return repoGit(args)
  } catch {
    return undefined
  }
}
const commitPresent = reader(["cat-file", "-e", `${ACCOUNT_CORE_MOVES.commit}^{commit}`]) !== undefined
const unverified = (reason: string): string => ` [UNVERIFIED in this shard: ${reason}]`

describe("the committed move list", () => {
  test.skipIf(!commitPresent)(
    `#given the pinned move commit #then the list is exactly every rename git reports there${commitPresent ? "" : unverified(`move commit absent; git fetch origin ${ACCOUNT_CORE_MOVES.commit}`)}`,
    () => {
      expect(moveListProblems(ACCOUNT_CORE_MOVES, reader)).toEqual([])
    },
  )

  test("#given a checkout without the move commit #then it is a problem naming the fetch, never a pass", () => {
    expect(moveListProblems(ACCOUNT_CORE_MOVES, () => undefined)).toEqual([
      `the move commit ${ACCOUNT_CORE_MOVES.commit} is not in this checkout: fetch it (git fetch origin ${ACCOUNT_CORE_MOVES.commit}) or check out with full history`,
    ])
  })

  test("#given a list widened by one pair git does not report #then it fails", () => {
    const git: GitReader = (args) =>
      args[0] === "cat-file"
        ? ""
        : "R100\tpackages/omo-opencode/src/cli/service-auth/a.ts\tpackages/account-core/src/a.ts\n"
    const widened: MoveSet = {
      commit: ACCOUNT_CORE_MOVES.commit,
      pairs: {
        "packages/omo-opencode/src/cli/service-auth/a.ts": "packages/account-core/src/a.ts",
        "x/y.ts": "packages/account-core/src/y.ts",
      },
    }
    expect(moveListProblems(widened, git)).toEqual([
      "moved-file list and git disagree on x/y.ts: list packages/account-core/src/y.ts, git (none)",
    ])
  })
})

describe("movedFileReport", () => {
  const from = "packages/omo-opencode/src/cli/service-auth/a.ts"
  const to = "packages/account-core/src/a.ts"
  const set: MoveSet = { commit: "c".repeat(40), pairs: { [from]: to } }
  const original = 'import { x } from "../x"\nexport const a = x\n'
  const trees = (
    base: Readonly<Record<string, string>>,
    head: Readonly<Record<string, string>>,
    imported: readonly string[] = [],
  ): Trees => ({
    base: "BASE",
    read: (at, path) => (at === "BASE" ? base : head)[path],
    list: (at, directory) => Object.keys(at === "BASE" ? base : head).filter((file) => file.startsWith(directory)),
    resolver: () => () => "packages/x.ts",
    imported: () => new Set(imported),
  })

  test("#given a moved file whose only change is a specifier naming the same module #then nothing is reported", () => {
    const report = movedFileReport(set, trees({ [from]: original }, { [to]: original.replace("../x", "../../x") }))
    expect(report).toEqual({ problems: [], hops: [], exempt: [] })
  })

  test("#given a moved file with one statement changed #then it is named", () => {
    const report = movedFileReport(set, trees({ [from]: original }, { [to]: original.replace("= x", "= x + 1") }))
    expect(report.problems).toEqual([`${to} differs from ${from} beyond its module specifiers`])
  })

  test("#given an extra, unmoved code file in the moved-to layer #then it fails (negative control)", () => {
    const extra = "packages/account-core/src/extra.ts"
    const report = movedFileReport(set, trees({ [from]: original }, { [to]: original, [extra]: "export {}\n" }))
    expect(report.problems).toEqual([
      `${extra} is new in packages/account-core/src/ and is not one of the files moved by cccccccccc`,
    ])
  })

  test("#given a new file named like a test that source code imports #then it is judged and fails (negative control)", () => {
    const helper = "packages/account-core/src/helper.test.ts"
    const report = movedFileReport(set, trees({ [from]: original }, { [to]: original, [helper]: "" }, [helper]))
    expect(report.problems).toEqual([
      `${helper} is new in packages/account-core/src/ and is not one of the files moved by cccccccccc`,
    ])
  })

  test("#given a new test file nothing imports #then it is exempt and listed", () => {
    const own = "packages/account-core/src/own.test.ts"
    expect(movedFileReport(set, trees({ [from]: original }, { [to]: original, [own]: "" })).exempt).toEqual([own])
  })
})

const BASE = probeBase(repoGit)
const moveIsNew =
  BASE.readable &&
  reader(["cat-file", "-e", `${BASE.base}:${Object.values(ACCOUNT_CORE_MOVES.pairs)[0]}`]) === undefined
describe("the account core move on this repository (runs while the merge base predates the move)", () => {
  test.skipIf(!moveIsNew)(
    `#given the merge base #then every moved file passes, and the re-export hops and the exempt file are exactly as recorded${moveIsNew ? "" : unverified(BASE.readable ? "the move is already in the merge base" : BASE.reason)}`,
    () => {
      const report = movedFileReport(ACCOUNT_CORE_MOVES, gitTrees(reader, BASE.readable ? BASE.base : "", REPO_ROOT))
      const helper = "packages/account-core/src/keychain-helper"
      const hop = (file: string, shim: string): string =>
        `${helper}/${file}: "../../../shared/${shim}" -> "@oh-my-opencode/utils/runtime" through packages/omo-opencode/src/shared/${shim}.ts`
      expect(report).toEqual({
        problems: [],
        hops: [
          hop("client.ts", "bun-spawn-shim"),
          hop("creator-handoff.ts", "bun-file-shim"),
          hop("creator-handoff.ts", "bun-spawn-shim"),
          hop("owner-marker.ts", "bun-spawn-shim"),
          hop("signature.ts", "bun-spawn-shim"),
        ],
        exempt: ["packages/account-core/src/non-disclosure.test.ts"],
      })
    },
  )
})
