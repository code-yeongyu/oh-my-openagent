import { lstatSync, readFileSync } from "node:fs"
import { dirname, posix, resolve } from "node:path"

export const USERNS_ROOTS_ENV = "OMO_ENGINE_TRUST_USERNS_ROOTS"
const MAX_ENTRIES = 64

type ReadText = (path: string) => string

export interface UsernsView {
  readonly namespaced: boolean
  readonly overflowUid: number | null
  readonly attested: ReadonlySet<string>
}

export interface InodeStat {
  readonly uid: number
  readonly dev: bigint
  readonly ino: bigint
}

const IDENTITY_MAP = /^\s*0\s+0\s+4294967295\s*$/
const INODE = /^\d+:\d+$/
const readProc: ReadText = (path) => readFileSync(path, "utf8")

function initialNamespace(read: ReadText): boolean | null {
  try { return IDENTITY_MAP.test(read("/proc/self/uid_map")) } catch { return null }
}

const entryKey = (path: string, inode: string): string => `${path}\n${inode}`

/** Strict: anything but a bounded JSON list of [absolute path, "dev:ino"] pairs attests nothing. */
function parseAttestation(text: string | undefined): Set<string> {
  if (text === undefined) return new Set()
  try {
    const entries: unknown = JSON.parse(text)
    if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) return new Set()
    const keys = new Set<string>()
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2) return new Set()
      const [path, inode] = entry as unknown[]
      if (typeof path !== "string" || !posix.isAbsolute(path) || posix.normalize(path) !== path
        || typeof inode !== "string" || !INODE.test(inode)) return new Set()
      keys.add(entryKey(path, inode))
    }
    return keys
  } catch {
    return new Set()
  }
}

/** Unreadable /proc yields a view that relaxes nothing. */
export function readUsernsView(env: NodeJS.ProcessEnv, read: ReadText = readProc): UsernsView {
  let overflowUid: number | null = null
  try {
    const text = read("/proc/sys/kernel/overflowuid").trim()
    overflowUid = /^\d+$/.test(text) ? Number(text) : null
  } catch {}
  return { namespaced: initialNamespace(read) === false, overflowUid, attested: parseAttestation(env[USERNS_ROOTS_ENV]) }
}

/**
 * Inside a user namespace the kernel shows every unmapped owner, root included, as the overflow uid,
 * so ownership is unknowable there. Only the exact path the launcher saw root-owned from the initial
 * namespace, still naming the same st_dev:st_ino, is treated as root; the caller walks the whole chain.
 */
export function attestedOverflowRoot(view: UsernsView, path: string, stat: InodeStat): boolean {
  return view.namespaced && view.overflowUid !== null && stat.uid === view.overflowUid
    && view.attested.has(entryKey(path, `${stat.dev}:${stat.ino}`))
}

export function attestUsernsRoots(paths: readonly string[], read: ReadText = readProc): string | undefined {
  if (initialNamespace(read) !== true) return undefined
  const entries = new Map<string, [string, string]>()
  for (const path of paths) {
    let current = resolve(path)
    for (;;) {
      try {
        const stat = lstatSync(current, { bigint: true })
        const mode = Number(stat.mode)
        if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0n
          && ((mode & 0o022) === 0 || (mode & 0o1000) !== 0)) entries.set(current, [current, `${stat.dev}:${stat.ino}`])
      } catch {}
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  const list = [...entries.values()].sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_ENTRIES)
  return list.length === 0 ? undefined : JSON.stringify(list)
}

export function inheritedTrustPaths(marker: string | undefined): string[] {
  try {
    const parsed = JSON.parse(marker ?? "") as { file?: unknown; defaults?: { file?: unknown; dir?: unknown } | null }
    return [parsed.file, parsed.defaults?.file, parsed.defaults?.dir].filter((path): path is string => typeof path === "string")
  } catch {
    return []
  }
}
