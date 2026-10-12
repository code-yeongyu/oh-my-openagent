// Git layout probe for the opt-in `memory.auto_identity: "git"` mode (#9659).
//
// A linked worktree's `.git` is a `gitdir: <admin>` pointer file whose admin directory holds a
// `commondir` file naming the shared git directory. Mapping the worktree onto the main working
// tree lets every worktree of one clone share the main checkout's memory, while the main checkout
// itself keeps exactly the path it hashes today. The main working tree is used only when it is
// known: the parent of a common dir named `.git`, `core.worktree`, or the common dir itself for a
// `core.bare` repository. Resolution walks up to the nearest `.git` entry and reads a few small
// files, never spawning `git`; every unreadable, forged or ambiguous layout answers "not a linked
// worktree" so the caller keeps the path-derived identity.

import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { readFileSync, realpathSync, statSync } from "../fs/resilient"

export type GitEntryKind = "directory" | "file"

export interface GitLayoutProbe {
  readonly entryKind: (path: string) => GitEntryKind | undefined
  readonly readText: (path: string) => string | undefined
  readonly realPath: (path: string) => string | undefined
}

export interface LinkedWorktreeSource {
  readonly hashSource: string
  readonly slugSource: string
}

interface CoreConfig {
  readonly bare: boolean | undefined
  readonly worktree: string | undefined
}

const GITDIR_POINTER = /^gitdir:\s*(.+)$/
const BARE_SUFFIX = /\.git$/
const SECTION_HEADER = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"[^"]*")?\s*\]/
const CORE_ENTRY = /^(bare|worktree)\s*=\s*(.*)$/i

const defaultGitLayoutProbe: GitLayoutProbe = {
  entryKind(path) {
    try {
      const stats = statSync(path)
      if (stats.isDirectory()) return "directory"
      return stats.isFile() ? "file" : undefined
    } catch {
      // A missing or unreadable entry means "no git marker here"; the walk moves on.
      return undefined
    }
  },
  readText(path) {
    try {
      return readFileSync(path, "utf8")
    } catch {
      // An unreadable pointer falls back to the path-derived identity by contract.
      return undefined
    }
  },
  realPath(path) {
    try {
      return realpathSync(path)
    } catch {
      // A path that cannot be canonicalized cannot be proven to match; the caller rejects it.
      return undefined
    }
  },
}

export function resolveLinkedWorktreeSource(
  cwd: string,
  probe: GitLayoutProbe = defaultGitLayoutProbe,
): LinkedWorktreeSource | undefined {
  const start = resolve(cwd)
  for (let dir = start; ; dir = dirname(dir)) {
    const marker = join(dir, ".git")
    const kind = probe.entryKind(marker)
    if (kind === "directory") return undefined
    if (kind === "file") return fromPointerFile(marker, dir, relative(dir, start), probe)
    if (dirname(dir) === dir) return undefined
  }
}

function fromPointerFile(
  marker: string,
  checkoutRoot: string,
  subpath: string,
  probe: GitLayoutProbe,
): LinkedWorktreeSource | undefined {
  const pointer = firstLine(probe.readText(marker))
  const target = pointer === undefined ? undefined : GITDIR_POINTER.exec(pointer)?.[1]?.trim()
  if (target === undefined || target === "") return undefined
  const adminDir = absolutize(target, checkoutRoot)
  const commonDirText = firstLine(probe.readText(join(adminDir, "commondir")))
  if (commonDirText === undefined || commonDirText === "") return undefined
  if (!pointsBackTo(adminDir, marker, probe)) return undefined
  const commonDir = absolutize(commonDirText, adminDir)
  const base = mainWorkingTree(commonDir, probe)
  if (base === undefined) return undefined
  const hashSource = subpath === "" ? base.root : join(base.root, subpath)
  if (subpath !== "") return { hashSource, slugSource: basename(hashSource) }
  return { hashSource, slugSource: base.slug }
}

// Git validates a linked worktree by its admin `gitdir` file naming this checkout's `.git`; a
// forged or stale pointer that claims another clone's admin directory fails the same check.
function pointsBackTo(adminDir: string, marker: string, probe: GitLayoutProbe): boolean {
  const backPointer = firstLine(probe.readText(join(adminDir, "gitdir")))
  if (backPointer === undefined || backPointer === "") return false
  const claimed = probe.realPath(absolutize(backPointer, adminDir))
  const actual = probe.realPath(marker)
  return claimed !== undefined && claimed === actual
}

function mainWorkingTree(commonDir: string, probe: GitLayoutProbe): { root: string; slug: string } | undefined {
  if (basename(commonDir) === ".git") {
    const root = dirname(commonDir)
    return { root, slug: basename(root) }
  }
  const core = readCoreConfig(probe.readText(join(commonDir, "config")))
  if (core.worktree !== undefined && core.worktree !== "") {
    const root = absolutize(core.worktree, commonDir)
    return { root, slug: basename(root) }
  }
  if (core.bare === true) {
    const name = basename(commonDir)
    return { root: commonDir, slug: name.replace(BARE_SUFFIX, "") || name }
  }
  return undefined
}

// Reads only the `[core]` keys written as `key = value`. `include`/`includeIf` files and a valueless
// `bare` line are not followed, which leaves the layout unknown and so keeps the path-derived id.
function readCoreConfig(text: string | undefined): CoreConfig {
  let bare: boolean | undefined
  let worktree: string | undefined
  let inCore = false
  for (const rawLine of (text ?? "").split(/\r?\n/)) {
    const line = rawLine.trim()
    const header = SECTION_HEADER.exec(line)
    if (header !== null) {
      inCore = header[1]?.toLowerCase() === "core"
      continue
    }
    if (!inCore) continue
    const entry = CORE_ENTRY.exec(line)
    if (entry === null) continue
    const value = unquote(entry[2] ?? "")
    if (entry[1]?.toLowerCase() === "bare") bare = /^(true|yes|on|1)$/i.test(value)
    else worktree = value
  }
  return { bare, worktree }
}

function unquote(raw: string): string {
  const value = raw.replace(/\s+[#;].*$/, "").trim()
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value
}

function firstLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined
  return text.split(/\r?\n/, 1)[0]?.trim()
}

function absolutize(path: string, base: string): string {
  return isAbsolute(path) ? resolve(path) : resolve(base, path)
}
