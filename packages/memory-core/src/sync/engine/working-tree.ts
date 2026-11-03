// The working tree as the sync engine sees it (#12147). The walk lists regular files and never
// enters a symlink: a received key whose path on this device goes through or names a symlink is
// refused (landing.ts), so capture must not send one either. Item keys are NFC while a file's
// on-disk name need not be; the key -> path map below is the one place that spelling is resolved,
// and a cycle reads, renders, lands and stages every key through it, so a received edit lands in
// the file the person has instead of a second spelling next to it.

import { join } from "node:path"

import { readdir } from "../../fs/resilient"
import { isSyncItemKey } from "../item"
import { TEMP_MARK } from "./atomic"

export interface TreeEntry {
  readonly name: string
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** Lists one directory, named relative to the memory root ("" is the root itself). */
export type ListDir = (relative: string) => Promise<readonly TreeEntry[]>

export const diskLister = (root: string): ListDir => (relative) => readdir(join(root, relative), { withFileTypes: true })

export interface WorkingTree {
  /** Regular files, "/"-separated and relative to the root; .git and temp files excluded. */
  readonly files: readonly string[]
  /** Symlinks, never entered: what they reach is not this device's to sync. */
  readonly symlinks: readonly string[]
}

export async function scanWorkingTree(list: ListDir): Promise<WorkingTree> {
  const files: string[] = []
  const symlinks: string[] = []
  const walk = async (relative: string): Promise<void> => {
    for (const entry of await list(relative)) {
      const path = relative === "" ? entry.name : `${relative}/${entry.name}`
      if (path === ".git") continue
      if (entry.isSymbolicLink()) symlinks.push(path)
      else if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && !path.includes(TEMP_MARK)) files.push(path)
    }
  }
  await walk("")
  return { files, symlinks }
}

export interface ItemPaths {
  /** Item key -> its file's on-disk path; null when two files normalize to the key. */
  readonly byKey: ReadonlyMap<string, string | null>
  /** Files that are no item, with the rule (an ambiguous key is named once, by the key). */
  readonly problems: readonly { readonly path: string; readonly rule: string }[]
}

export function itemPaths(files: readonly string[]): ItemPaths {
  const byKey = new Map<string, string | null>()
  const problems: { path: string; rule: string }[] = []
  for (const path of files) {
    const key = path.normalize("NFC")
    const problem = isSyncItemKey(key)
    if (problem !== null) problems.push({ path, rule: problem })
    else if (!byKey.has(key)) byKey.set(key, path)
    else if (byKey.get(key) !== null) {
      byKey.set(key, null)
      problems.push({ path: key, rule: "ambiguous-normalization" })
    }
  }
  return { byKey, problems }
}

/** Where `key` lives on this device: its file's spelling, the key itself for a new file, or null when ambiguous. */
export function landingPath(paths: ItemPaths, key: string): string | null {
  const path = paths.byKey.get(key)
  return path === undefined ? key : path
}
