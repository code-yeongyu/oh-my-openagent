import { describe, expect, test } from "bun:test"
import { execFileSync } from "node:child_process"

import {
  ACCOUNT_CORE_MOVES,
  blankModuleSpecifiers,
  type MoveSet,
  movedFileProblems,
  movedLayerRenames,
  type Trees,
} from "./remote-import-guard-moves"
import { REPO_ROOT } from "./sdk-parity/registry"

// Architecture contract (#14364, the LEAD's ruling on review 6065350035): a moved layer admits its old offenders only for
// git's own renames at the move commit, each unchanged apart from module specifiers.

const git = (...args: string[]): string | undefined => {
  try {
    return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return undefined
  }
}

const moveCommitReadable = git("cat-file", "-e", `${ACCOUNT_CORE_MOVES.commit}^{commit}`) !== undefined
describe("the committed move list (runs whenever the move commit is in this checkout)", () => {
  test.skipIf(!moveCommitReadable)(
    `#given the move commit #then the list is exactly git's renames into a moved-to layer${moveCommitReadable ? "" : " [skipped: the move commit is not in this shallow checkout]"}`,
    () => {
      const commit = ACCOUNT_CORE_MOVES.commit
      const into = new Set(Object.values(movedLayerRenames(ACCOUNT_CORE_MOVES)))
      const renames = (git("diff", "--name-status", "-M", `${commit}^`, commit) ?? "")
        .split("\n")
        .map((line) => line.split("\t"))
        .filter(
          ([status, , to]) => status?.startsWith("R") === true && [...into].some((layer) => to?.startsWith(layer)),
        )
      expect(Object.fromEntries(renames.map(([, from, to]) => [from, to]))).toEqual(ACCOUNT_CORE_MOVES.pairs)
    },
  )
})

describe("blankModuleSpecifiers", () => {
  const before = [
    'import { a } from "../cli/service-auth/a"',
    'import type { B } from "./b"',
    'export * from "./c"',
    'import "./side-effect"',
    'const d = await import("./d")',
    'const e = require("./e")',
    'const label = "kept"',
  ].join("\n")

  test("#given a file whose only change is every kind of module specifier #then both sides compare equal", () => {
    const after = before
      .replace("../cli/service-auth/a", "../../account-core/src/a")
      .replace('"./b"', '"../b"')
      .replace('"./c"', '"./core/c"')
      .replace('"./side-effect"', '"../side-effect"')
      .replace('"./d"', '"./x/d"')
      .replace('"./e"', '"./x/e"')
    expect(blankModuleSpecifiers(after)).toBe(blankModuleSpecifiers(before))
  })

  test("#given the same file with one statement changed #then the sides differ", () => {
    expect(blankModuleSpecifiers(before.replace('"kept"', '"changed"'))).not.toBe(blankModuleSpecifiers(before))
  })
})

describe("movedFileProblems", () => {
  const trees = (base: Readonly<Record<string, string>>, head: Readonly<Record<string, string>>): Trees => ({
    base: "BASE",
    read: (at, path) => (at === "BASE" ? base : head)[path],
    list: (at, directory) => Object.keys(at === "BASE" ? base : head).filter((file) => file.startsWith(directory)),
  })
  const from = "packages/omo-opencode/src/cli/service-auth/a.ts"
  const to = "packages/account-core/src/a.ts"
  const layerSet: MoveSet = { commit: "c".repeat(40), pairs: { [from]: to } }
  const original = 'import { x } from "../x"\nexport const a = x\n'

  test("#given a moved file whose only change is its specifiers #then nothing is reported", () => {
    expect(
      movedFileProblems(layerSet, trees({ [from]: original }, { [to]: original.replace("../x", "../../x") })),
    ).toEqual([])
  })

  test("#given a moved file with one statement changed #then it is named", () => {
    expect(
      movedFileProblems(layerSet, trees({ [from]: original }, { [to]: original.replace("= x", "= x + 1") })),
    ).toEqual([`${to} differs from ${from} beyond its module specifiers`])
  })

  test("#given an extra, unmoved code file in the moved-to layer #then it fails (negative control)", () => {
    const extra = "packages/account-core/src/extra.ts"
    expect(
      movedFileProblems(layerSet, trees({ [from]: original }, { [to]: original, [extra]: "export {}\n" })),
    ).toEqual([`${extra} is new in packages/account-core/src/ and is not one of the files moved by cccccccccc`])
  })

  test("#given new package metadata and a new test file in the layer #then they are not adapter-reachable code and pass", () => {
    const head = {
      [to]: original,
      "packages/account-core/package.json": "{}",
      "packages/account-core/src/n.test.ts": "",
    }
    expect(movedFileProblems(layerSet, trees({ [from]: original }, head))).toEqual([])
  })

  test("#given a file the merge base already has #then it is not new and is not judged", () => {
    const kept = "packages/account-core/src/kept.ts"
    expect(
      movedFileProblems(layerSet, trees({ [from]: original, [kept]: "a" }, { [to]: original, [kept]: "b" })),
    ).toEqual([])
  })
})
