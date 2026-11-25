import { offenderGrowth } from "./remote-import-guard-adapter"
import moves from "./remote-import-guard-account-moves.json"
import { type GitReader, gitTrees, type Trees } from "./remote-import-guard-git-trees"
import { blankModuleSpecifiers, specifierIdentity } from "./remote-import-guard-move-identity"
import { ADAPTER_RULES } from "./remote-import-guard-rules"

// A layer whose code moved keeps its offenders, file by file (#14364, the LEAD's ruling on review 6065350035 and the
// design lane's on the next round). The moved files are git's own renames at the move commit, pinned by its full sha and
// committed as data (remote-import-guard-account-moves.json); the gate fails when that commit is absent or git disagrees.
// A base row naming a layer a moved file left admits the layer it moved to ONLY while every new file of that layer is one
// of those moves, equal to its source with module specifiers blanked, each changed specifier naming the same module
// (remote-import-guard-move-identity.ts). Any other new file fails, except a test or a non-code file that no non-test
// source file imports by any edge form: one no adapter can reach.

export type MoveSet = { readonly commit: string; readonly pairs: Readonly<Record<string, string>> }
export const ACCOUNT_CORE_MOVES: MoveSet = moves

const CODE = /\.[cm]?[jt]sx?$/
const lines = (text: string | undefined): string[] => (text ?? "").split("\n").filter(Boolean)

/** The trees for the moved-file check, prefetching every manifest, both ends of every pair and the moved-to layers. */
export function moveTrees(git: GitReader, base: string, repoRoot: string, set: MoveSet = ACCOUNT_CORE_MOVES): Trees {
  const layers = [...new Set(Object.values(movedLayerRenames(set)))]
  const ends = [...Object.keys(set.pairs), ...Object.values(set.pairs)]
  return gitTrees(git, base, repoRoot, (files) => [
    ...ends,
    ...[...files].filter((file) => file.endsWith("package.json") || layers.some((layer) => file.startsWith(layer))),
  ])
}

/** The committed pairs against every rename git reports at the pinned commit; an absent commit fails. */
export function moveListProblems(set: MoveSet, git: GitReader): string[] {
  const commit = set.commit
  if (git(["cat-file", "-e", `${commit}^{commit}`]) === undefined) {
    return [
      `the move commit ${commit} is not in this checkout: fetch it (git fetch origin ${commit}) or check out with full history`,
    ]
  }
  const fromGit = Object.fromEntries(
    lines(git(["diff", "--name-status", "-M", `${commit}^`, commit]))
      .map((line) => line.split("\t"))
      .filter(([status]) => status?.startsWith("R") === true)
      .map(([, from, to]) => [from, to]),
  )
  return [...new Set([...Object.keys(fromGit), ...Object.keys(set.pairs)])]
    .filter((from) => fromGit[from] !== set.pairs[from])
    .toSorted()
    .map(
      (from) =>
        `moved-file list and git disagree on ${from}: list ${set.pairs[from] ?? "(none)"}, git ${fromGit[from] ?? "(none)"}`,
    )
}

const layerOf = (file: string): string | undefined => ADAPTER_RULES.forbidden.find((layer) => file.startsWith(layer))

export function movedLayerRenames(set: MoveSet): Readonly<Record<string, string>> {
  const renames: Record<string, string> = {}
  for (const [from, to] of Object.entries(set.pairs)) {
    const before = layerOf(from)
    const after = layerOf(to)
    if (before !== undefined && after !== undefined && before !== after) renames[before] = after
  }
  return renames
}

export type MovedFileReport = {
  readonly problems: readonly string[]
  /** Changed specifiers admitted through a checked one-hop pure re-export. */
  readonly hops: readonly string[]
  /** New, unmoved files of the layer that pass because they are tests or non-code and nothing reachable imports them. */
  readonly exempt: readonly string[]
}

export function movedFileReport(set: MoveSet, trees: Trees): MovedFileReport {
  const origin = new Map(Object.entries(set.pairs).map(([from, to]) => [to, from]))
  const problems: string[] = []
  const hops: string[] = []
  const exempt: string[] = []
  for (const layer of new Set(Object.values(movedLayerRenames(set)))) {
    for (const file of trees.list("HEAD", layer)) {
      if (trees.read(trees.base, file) !== undefined) continue
      const from = origin.get(file)
      if (from === undefined) {
        const reachable = (CODE.test(file) && !ADAPTER_RULES.testFile(file)) || trees.isImported(file)
        if (reachable)
          problems.push(`${file} is new in ${layer} and is not one of the files moved by ${set.commit.slice(0, 10)}`)
        else exempt.push(file)
        continue
      }
      const before = trees.read(trees.base, from)
      const after = trees.read("HEAD", file) ?? ""
      if (before === undefined) {
        problems.push(`${file} is listed as moved from ${from}, which the merge base does not have`)
      } else if (blankModuleSpecifiers(before) !== blankModuleSpecifiers(after)) {
        problems.push(`${file} differs from ${from} beyond its module specifiers`)
      } else {
        const identity = specifierIdentity(from, file, before, after, {
          resolveBase: trees.resolver(trees.base),
          resolveHead: trees.resolver("HEAD"),
          readBase: (path) => trees.read(trees.base, path),
          pairs: set.pairs,
        })
        problems.push(...identity.problems)
        hops.push(...identity.hops)
      }
    }
  }
  const missing = trees.missing()
  return missing.length > 0 ? { problems: [...missing, ...problems], hops, exempt } : { problems, hops, exempt }
}

/**
 * The offender record against the merge base's (both homes: gate-cli and base-probe). The move admission is used only
 * where a row needs it, and then the moved layer must hold nothing but its moved files.
 */
export function offenderBaseGrowth(
  base: Parameters<typeof offenderGrowth>[0],
  head: Parameters<typeof offenderGrowth>[1],
  trees: Trees,
): string[] {
  const growth = offenderGrowth(base, head, movedLayerRenames(ACCOUNT_CORE_MOVES))
  const admittedByMove = offenderGrowth(base, head).length > growth.length
  return admittedByMove ? [...growth, ...movedFileReport(ACCOUNT_CORE_MOVES, trees).problems] : growth
}
