import { relative, sep } from "node:path"

import { offenderGrowth } from "./remote-import-guard-adapter"
import moves from "./remote-import-guard-account-moves.json"
import { blankModuleSpecifiers, specifierIdentity } from "./remote-import-guard-move-identity"
import { createResolver, type Resolver, type ResolverFiles } from "./remote-import-guard-resolve"
import { ADAPTER_RULES } from "./remote-import-guard-rules"
import { type FileFacts, scanRepository } from "./remote-import-guard-scan"

// A layer whose code moved keeps its offenders, file by file (#14364, the LEAD's ruling on review 6065350035 and the
// design lane's on the next round). The moved files are git's own renames at the move commit, pinned by its full sha and
// committed as data (remote-import-guard-account-moves.json); the gate fails when that commit is absent or git disagrees.
// A base row naming a layer a moved file left admits the layer it moved to ONLY while every new file of that layer is one
// of those moves, equal to its source with module specifiers blanked, each changed specifier naming the same module
// (remote-import-guard-move-identity.ts). Any other new file fails, except a test or a non-code file that no non-test
// source file imports by any edge form: one no adapter can reach.

export type MoveSet = { readonly commit: string; readonly pairs: Readonly<Record<string, string>> }
export const ACCOUNT_CORE_MOVES: MoveSet = moves

/** Runs git in the repository; undefined when git fails (an object this checkout does not have). */
export type GitReader = (args: readonly string[]) => string | undefined

export type Trees = {
  readonly base: string
  /** A file at a revision (`HEAD` or the merge base); undefined when that tree has no such file. */
  readonly read: (ref: string, path: string) => string | undefined
  readonly list: (ref: string, directory: string) => readonly string[]
  readonly resolver: (ref: string) => Resolver
  /** The files some non-test source file imports at the head, by any edge form. */
  readonly imported: () => ReadonlySet<string>
}

const CODE = /\.[cm]?[jt]sx?$/
const toPosix = (path: string): string => path.split(sep).join("/")
const lines = (text: string | undefined): string[] => (text ?? "").split("\n").filter(Boolean)

export function importedFiles(facts: readonly FileFacts[], resolve: Resolver): ReadonlySet<string> {
  const imported = new Set<string>()
  for (const fact of facts) {
    if (ADAPTER_RULES.testFile(fact.file)) continue
    for (const edge of fact.edges) {
      const target = resolve(fact.file, edge.specifier)
      if (target !== undefined) imported.add(target)
    }
  }
  return imported
}

function gitTreeFiles(git: GitReader, ref: string, repoRoot: string): ResolverFiles {
  const files = new Set(lines(git(["ls-tree", "-r", "--name-only", ref])))
  const children = new Map<string, Set<string>>()
  for (const file of files) {
    const parts = file.split("/")
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth - 1).join("/")
      const set = children.get(parent) ?? new Set<string>()
      set.add(parts[depth - 1] ?? "")
      children.set(parent, set)
    }
  }
  const inRepo = (path: string): string => toPosix(relative(repoRoot, path))
  return {
    isFile: (path) => files.has(inRepo(path)),
    readText: (path) => git(["show", `${ref}:${inRepo(path)}`]) ?? "",
    directories: (path) => [...(children.get(inRepo(path)) ?? [])],
  }
}

/** Both homes read both sides from git at their exact revisions, and resolve the head's imports from the disk once. */
export function gitTrees(git: GitReader, base: string, repoRoot: string): Trees {
  const resolvers = new Map<string, Resolver>()
  let imported: ReadonlySet<string> | undefined
  return {
    base,
    read: (ref, path) => git(["show", `${ref}:${path}`]),
    list: (ref, directory) => lines(git(["ls-tree", "-r", "--name-only", ref, "--", directory])),
    resolver: (ref) => {
      const resolve = resolvers.get(ref) ?? createResolver(repoRoot, gitTreeFiles(git, ref, repoRoot))
      resolvers.set(ref, resolve)
      return resolve
    },
    imported: () => {
      imported ??= importedFiles(scanRepository(repoRoot), createResolver(repoRoot))
      return imported
    },
  }
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
        const reachable = (CODE.test(file) && !ADAPTER_RULES.testFile(file)) || trees.imported().has(file)
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
  return { problems, hops, exempt }
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
