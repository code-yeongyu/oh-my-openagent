import { join, resolve } from "node:path"
import { lstatSync, readFileSync, type BigIntStats } from "../fs/resilient"

interface CachedFile {
  readonly stamp: string
  readonly text: string
}

// Repo instances are recreated for each prompt. Bound the process cache, not an instance cache.
const files = new Map<string, CachedFile>()
const FILE_CACHE_SIZE = 256
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const REPO_ENV = ["GIT_DIR", "GIT_COMMON_DIR", "GIT_WORK_TREE", "GIT_NAMESPACE", "GIT_CONFIG", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS"]

/** Undefined asks the caller to use git's authoritative resolver for an unfamiliar layout. */
export function readHeadFromFiles(repoDir: string): string | undefined {
  if (REPO_ENV.some((key) => process.env[key] !== undefined)) return undefined
  try {
    const marker = resolve(repoDir, ".git")
    const markerStat = lstatSync(marker, { bigint: true, throwIfNoEntry: false })
    let gitDir = marker
    if (markerStat?.isFile()) {
      const pointer = readText(marker)
      const target = typeof pointer === "string" ? /^gitdir: ([^\r\n]+)\r?\n?$/.exec(pointer)?.[1] : undefined
      if (target === undefined) return undefined
      gitDir = resolve(repoDir, target)
    } else if (!markerStat?.isDirectory()) return undefined

    const common = readText(join(gitDir, "commondir"))
    if (common === null || common === "" || (common !== undefined && !/^[^\r\n]+\r?\n?$/.test(common))) return undefined
    const commonDir = common === undefined ? gitDir : resolve(gitDir, common.trim())
    const config = readText(join(commonDir, "config"))
    // Includes, worktree config, and alternative ref backends are git's job.
    if (typeof config !== "string" || /^\s*(?:\[include(?:if)?\b|(?:refstorage|worktreeconfig)\s*(?:=|$))/im.test(config)) return undefined
    if ([gitDir, commonDir].some((dir) => lstatSync(join(dir, "config.worktree"), { throwIfNoEntry: false }) !== undefined)) return undefined
    // Detect reftable storage even when selected through system/global rather than local config.
    if (lstatSync(join(commonDir, "reftable"), { throwIfNoEntry: false }) !== undefined) return undefined
    if (!lstatSync(join(commonDir, "objects"), { throwIfNoEntry: false })?.isDirectory()) return undefined

    const head = readText(join(gitDir, "HEAD"))
    if (typeof head !== "string") return undefined
    const detached = objectId(head)
    if (detached !== undefined) return detached
    const ref = /^ref: (refs\/heads\/[A-Za-z0-9_./-]+)\r?\n?$/.exec(head)?.[1]
    if (ref === undefined || ref.includes("..") || ref.split("/").some((part) => !part || part.startsWith(".") || part.endsWith(".") || part.endsWith(".lock"))) return undefined
    const loose = readText(join(commonDir, ref))
    if (loose !== undefined) return typeof loose === "string" ? objectId(loose) : undefined
    const packed = readText(join(commonDir, "packed-refs"))
    if (typeof packed !== "string") return undefined
    let found: string | undefined
    for (const line of packed.split(/\r?\n/)) {
      if (line === "" || line.startsWith("#")) continue
      if (line.startsWith("^") && OBJECT_ID.test(line.slice(1))) continue
      const entry = /^([0-9a-f]{40}|[0-9a-f]{64}) (refs\/\S+)$/.exec(line)
      if (entry === null) return undefined
      if (entry[2] === ref) {
        if (found !== undefined) return undefined
        found = entry[1]
      }
    }
    return found
  } catch (error) {
    // Files can disappear, become unreadable, or be replaced while refs are updated. Git retains
    // responsibility for the error/null behavior; programming errors must still surface.
    if (error instanceof Error && "code" in error) return undefined
    throw error
  }
}

function objectId(text: string): string | undefined {
  const value = text.replace(/\r?\n$/, "")
  return OBJECT_ID.test(value) ? value : undefined
}

function stamp(stats: BigIntStats): string {
  return `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`
}

/** Missing is undefined; non-regular or concurrently changed files are unsupported (null). */
function readText(path: string): string | null | undefined {
  const stats = lstatSync(path, { bigint: true, throwIfNoEntry: false })
  if (stats === undefined) {
    files.delete(path)
    return undefined
  }
  if (!stats.isFile()) return null
  const current = stamp(stats)
  const cached = files.get(path)
  if (cached?.stamp === current) {
    files.delete(path)
    files.set(path, cached)
    return cached.text
  }
  const text = readFileSync(path, "utf8")
  const after = lstatSync(path, { bigint: true, throwIfNoEntry: false })
  if (after === undefined || stamp(after) !== current) return null
  files.set(path, { stamp: current, text })
  const oldest = files.keys().next().value
  if (files.size > FILE_CACHE_SIZE && oldest !== undefined) files.delete(oldest)
  return text
}
