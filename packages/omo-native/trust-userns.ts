import { lstatSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

export const USERNS_ROOTS_ENV = "OMO_ENGINE_TRUST_USERNS_ROOTS"

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
const readProc: ReadText = (path) => readFileSync(path, "utf8")

function initialNamespace(read: ReadText): boolean | null {
  try { return IDENTITY_MAP.test(read("/proc/self/uid_map")) } catch { return null }
}

export const inodeKey = (stat: { readonly dev: bigint; readonly ino: bigint }): string => `${stat.dev}:${stat.ino}`

/** Unreadable /proc yields a view that relaxes nothing. */
export function readUsernsView(env: NodeJS.ProcessEnv, read: ReadText = readProc): UsernsView {
  const initial = initialNamespace(read)
  let overflowUid: number | null = null
  try {
    const text = read("/proc/sys/kernel/overflowuid").trim()
    overflowUid = /^\d+$/.test(text) ? Number(text) : null
  } catch {}
  const attested = new Set((env[USERNS_ROOTS_ENV] ?? "").split(",").filter((key) => /^\d+:\d+$/.test(key)))
  return { namespaced: initial === false, overflowUid, attested }
}

/**
 * Inside a user namespace the kernel shows every unmapped owner, root included, as the overflow uid,
 * so ownership is unknowable there. Only an inode the launcher saw root-owned from the initial
 * namespace (by st_dev:st_ino, which a non-root user can neither re-own nor forge) is treated as root.
 */
export function attestedOverflowRoot(view: UsernsView, stat: InodeStat): boolean {
  return view.namespaced && view.overflowUid !== null && stat.uid === view.overflowUid && view.attested.has(inodeKey(stat))
}

export function attestUsernsRoots(paths: readonly string[], read: ReadText = readProc): string | undefined {
  if (initialNamespace(read) !== true) return undefined
  const keys = new Set<string>()
  for (const path of paths) {
    let current = resolve(path)
    for (;;) {
      try {
        const stat = lstatSync(current, { bigint: true })
        const mode = Number(stat.mode)
        if (stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0n
          && ((mode & 0o022) === 0 || (mode & 0o1000) !== 0)) keys.add(inodeKey(stat))
      } catch {}
      const parent = dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return keys.size === 0 ? undefined : [...keys].sort().join(",")
}
