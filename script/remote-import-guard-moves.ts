import { offenderGrowth } from "./remote-import-guard-adapter"
import moves from "./remote-import-guard-account-moves.json"
import { ADAPTER_RULES } from "./remote-import-guard-rules"

// A layer whose code moved keeps its offenders, file by file (#14364, the LEAD's ruling on review 6065350035). The moved
// files are git's own renames at the move commit, committed as data (remote-import-guard-account-moves.json, held equal to
// git by its test). A base row naming a layer a moved file left admits the layer it moved to ONLY while every new file of
// that layer is one of those moves with its content unchanged apart from module specifiers; any other new code file fails.

export type MoveSet = { readonly commit: string; readonly pairs: Readonly<Record<string, string>> }
export const ACCOUNT_CORE_MOVES: MoveSet = moves

/** Reads a file at a revision (`HEAD` or the merge base); undefined when that tree has no such file. */
export type TreeReader = (ref: string, path: string) => string | undefined
export type TreeLister = (ref: string, directory: string) => readonly string[]
export type Trees = { readonly base: string; readonly read: TreeReader; readonly list: TreeLister }

type OffenderRecord = Parameters<typeof offenderGrowth>[1]

const SPECIFIER = [
  /(\bfrom\s*)(["'])[^"'\n]*\2/g,
  /(\bimport\s*)(["'])[^"'\n]*\2/g,
  /(\bimport\s*\(\s*)(["'])[^"'\n]*\2/g,
  /(\brequire\s*\(\s*)(["'])[^"'\n]*\2/g,
]
const CODE = /\.[cm]?[jt]sx?$/

/** The text with every module specifier blanked and nothing else touched: the comparison a pure move must pass. */
export function blankModuleSpecifiers(text: string): string {
  return SPECIFIER.reduce((current, pattern) => current.replace(pattern, "$1$2$2"), text)
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

export function movedFileProblems(set: MoveSet, trees: Trees): string[] {
  const origin = new Map(Object.entries(set.pairs).map(([from, to]) => [to, from]))
  const problems: string[] = []
  for (const layer of new Set(Object.values(movedLayerRenames(set)))) {
    for (const file of trees.list("HEAD", layer)) {
      if (trees.read(trees.base, file) !== undefined) continue
      const from = origin.get(file)
      if (from === undefined) {
        if (CODE.test(file) && !ADAPTER_RULES.testFile(file)) {
          problems.push(`${file} is new in ${layer} and is not one of the files moved by ${set.commit.slice(0, 10)}`)
        }
        continue
      }
      const before = trees.read(trees.base, from)
      const after = trees.read("HEAD", file) ?? ""
      if (before === undefined)
        problems.push(`${file} is listed as moved from ${from}, which the merge base does not have`)
      else if (blankModuleSpecifiers(before) !== blankModuleSpecifiers(after)) {
        problems.push(`${file} differs from ${from} beyond its module specifiers`)
      }
    }
  }
  return problems
}

/**
 * The offender record against the merge base's (both homes: gate-cli and base-probe). The move admission is used only
 * where a row needs it, and then the moved layer must hold nothing but its moved files.
 */
export function offenderBaseGrowth(base: OffenderRecord | undefined, head: OffenderRecord, trees: Trees): string[] {
  const growth = offenderGrowth(base, head, movedLayerRenames(ACCOUNT_CORE_MOVES))
  const admittedByMove = offenderGrowth(base, head).length > growth.length
  return admittedByMove ? [...growth, ...movedFileProblems(ACCOUNT_CORE_MOVES, trees)] : growth
}
