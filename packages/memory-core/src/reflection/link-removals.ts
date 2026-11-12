import { posix } from "node:path"
import type { Run } from "./completion-repair"
import { ARCHIVE_PATH, type Successor } from "./link-rewrite"

export interface TreeEntry {
  readonly path: string
  readonly regular: boolean
}

export interface Removals {
  readonly removed: ReadonlyMap<string, Successor>
  /** rename destination -> its source, so a moved note's own relative links are resolved from where they were written */
  readonly movedFrom: ReadonlyMap<string, string>
}

export async function listTree(run: Run, revision: string): Promise<TreeEntry[]> {
  const out = await must(run, ["ls-tree", "-r", "-z", "--full-tree", revision])
  return out
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t")
      const [mode = ""] = line.slice(0, tab).split(" ")
      return { path: line.slice(tab + 1), regular: mode === "100644" || mode === "100755" }
    })
}

/** Every path `base..tip` removed, with where its links go: the rename destination, the archive, or nowhere. */
export async function removedPaths(
  run: Run,
  baseSha: string,
  tipSha: string,
  live: ReadonlySet<string>,
): Promise<Removals> {
  const parts = (await must(run, ["diff", "--name-status", "-M", "-z", `${baseSha}..${tipSha}`, "--"])).split("\0")
  const deleted: string[] = []
  const removed = new Map<string, Successor>()
  const movedFrom = new Map<string, string>()
  for (let index = 0; index < parts.length;) {
    const status = parts[index] ?? ""
    if (status === "") break
    if (status.startsWith("R") || status.startsWith("C")) {
      const from = parts[index + 1]
      const to = parts[index + 2]
      if (status.startsWith("R") && from !== undefined && to !== undefined && !live.has(from)) {
        removed.set(from, { kind: "moved", path: to })
        movedFrom.set(to, from)
      }
      index += 3
      continue
    }
    const path = parts[index + 1]
    if (status === "D" && path !== undefined && !live.has(path)) deleted.push(path)
    index += 2
  }
  const archived = live.has(ARCHIVE_PATH) ? await archiveAdditions(run, baseSha, tipSha) : ""
  const names = new Map<string, number>()
  for (const path of [...live, ...deleted]) names.set(posix.basename(path), (names.get(posix.basename(path)) ?? 0) + 1)
  for (const path of deleted) {
    const unique = names.get(posix.basename(path)) === 1
    removed.set(path, recordedIn(archived, path, unique) ? { kind: "archived" } : { kind: "removed" })
  }
  return { removed, movedFrom }
}

async function archiveAdditions(run: Run, baseSha: string, tipSha: string): Promise<string> {
  const out = await must(run, ["diff", "-U0", "--no-color", baseSha, tipSha, "--", ARCHIVE_PATH])
  return out
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .join("\n")
}

/**
 * Whether the lines this run added to `ARCHIVE.md` name `path`: its repository path (with or without `.md`), or its
 * bare file name with `.md` when no other note shares that name. The name must end there, so `x.mdx` or `x.txt`
 * never counts as naming `x.md`.
 */
function recordedIn(archived: string, path: string, uniqueName: boolean): boolean {
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const end = "(?![\\w/-]|\\.\\w)"
  const start = "(^|[^\\w./-])"
  const stem = escape(path.replace(/\.md$/, ""))
  if (new RegExp(`${start}${stem}(\\.md)?${end}`).test(archived)) return true
  return (
    uniqueName && path.endsWith(".md") && new RegExp(`${start}${escape(posix.basename(path))}${end}`).test(archived)
  )
}

export async function must(run: Run, argv: readonly string[]): Promise<string> {
  const result = await run(argv)
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${argv.join(" ")} failed`)
  return result.stdout
}
