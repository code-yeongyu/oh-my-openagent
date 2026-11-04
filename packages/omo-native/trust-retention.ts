import { constants } from "node:fs"
import * as nodeFs from "node:fs/promises"
import { join } from "node:path"

/** Design 5.3 Retention: the most recently used generations a sweep never evicts. */
export const RETAINED_GENERATIONS = 16

/**
 * senpi's `BOOT_INSTANT_TOLERANCE_MS` (terminal/process-identity.ts): a boot instant derived from
 * whole-second `os.uptime()` drifts by rounding, so "this boot's" is senpi's `sameBoot`, not `===`.
 * Erring wide only keeps a file longer; erring narrow would evict a live generation.
 */
const BOOT_INSTANT_TOLERANCE_MS = 120_000
const HEADER_BYTES = 128
const LEASE_BYTES = 4096

const GENERATION = /^([0-9a-f]{64})\.pem$/
const USER_EXTRAS = /^u-([0-9a-f]{64})\.pem$/
const LEASE = /^([0-9a-f]{64})\.([1-9][0-9]*)$/
const HEADER = /^# omo-engine-trust-generation v1 user=([0-9a-f]{64}|none)\r?\n/

export interface TrustRetentionStat {
  readonly mtimeMs: number
  readonly uid: number
  readonly mode: number
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

/** `lstat` only: the sweep never resolves a link. `open` receives `O_NOFOLLOW` where the OS has it. */
export interface TrustRetentionFs {
  readdir(path: string): Promise<string[]>
  lstat(path: string): Promise<TrustRetentionStat>
  open(path: string, flags: number): Promise<{
    read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<{ readonly bytesRead: number }>
    stat(): Promise<TrustRetentionStat>
    close(): Promise<void>
  }>
  unlink(path: string): Promise<void>
}

export interface TrustRetentionOptions {
  /** The trust directory (`~/.omo/engine-trust`), holding generations, user-extras files and `leases/`. */
  readonly directory: string
  /** This boot's instant, as written in a lease's `bootAtMs`. */
  readonly bootAtMs: number
  /** `kill(pid, 0)` answers; `pidAnswersSignalZero` in production. */
  readonly isPidAlive: (pid: number) => boolean
  /** The generation the caller just wrote: retained even if a stepped clock ranks it out. */
  readonly current?: string
  readonly fs?: TrustRetentionFs
}

export interface TrustRetentionFailure {
  /** A name relative to the trust directory, never an absolute path. */
  readonly entry: string
  readonly step:
    | "inspect"
    | "list"
    | "read-lease"
    | "probe-lease"
    | "inspect-generation"
    | "read-header"
    | "remove-generation"
    | "remove-lease"
    | "remove-user-extras"
    | "unexpected"
  readonly code: string
}

/** Never thrown: a sweep failure must not fail the launch that runs it. */
export type TrustRetentionOutcome =
  | {
    readonly kind: "swept"
    /** Generation and user-extras digests, and lease entry names, each sorted. */
    readonly removed: { readonly generations: readonly string[]; readonly leases: readonly string[]; readonly userExtras: readonly string[] }
    readonly failures: readonly TrustRetentionFailure[]
  }
  | { readonly kind: "skipped"; readonly reason: "directory-unsafe" | "leases-unsafe" | "sweep-error"; readonly failures: readonly TrustRetentionFailure[] }

export function pidAnswersSignalZero(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "ESRCH") return false
      if (error.code === "EPERM") return true
    }
    throw error
  }
}

const codeOf = (error: unknown): string =>
  error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "unknown"
const missing = (error: unknown) => codeOf(error) === "ENOENT"

class StepError extends Error {
  override readonly name = "StepError"
  constructor(readonly failure: TrustRetentionFailure) {
    super(`${failure.step} ${failure.entry}: ${failure.code}`)
  }
}

/** Design 5.3 directory rule: a real directory, and on POSIX owned by this user with no group or other bits. */
function safeDirectory(stat: TrustRetentionStat): boolean {
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false
  const uid = process.getuid?.()
  return uid === undefined || (stat.uid === uid && (stat.mode & 0o077) === 0)
}

async function readPrefix(fs: TrustRetentionFs, path: string, limit: number): Promise<string> {
  // O_NONBLOCK: a FIFO swapped in after lstat must not hang the launch; regular files ignore it.
  const handle = await fs.open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0))
  try {
    if (!(await handle.stat()).isFile()) throw Object.assign(new Error("not a regular file"), { code: "ENOTREG" })
    const buffer = new Uint8Array(limit)
    let length = 0
    while (length < limit) {
      const { bytesRead } = await handle.read(buffer, length, limit - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    return Buffer.from(buffer.subarray(0, length)).toString("latin1")
  } finally {
    await handle.close()
  }
}

/** Regular files whose names match; links and other objects are neither read nor removed. */
async function regularEntries(
  fs: TrustRetentionFs,
  directory: string,
  names: readonly string[],
  pattern: RegExp,
  prefix: string,
  failStep: TrustRetentionFailure["step"],
) {
  const found: { readonly entry: string; readonly match: RegExpExecArray; readonly stat: TrustRetentionStat | null }[] = []
  const failures: TrustRetentionFailure[] = []
  for (const entry of names) {
    const match = pattern.exec(entry)
    if (!match) continue
    try {
      const stat = await fs.lstat(join(directory, entry))
      if (stat.isFile() && !stat.isSymbolicLink()) found.push({ entry, match, stat })
    } catch (error) {
      if (missing(error)) continue
      failures.push({ entry: `${prefix}${entry}`, step: failStep, code: codeOf(error) })
      found.push({ entry, match, stat: null })
    }
  }
  return { found, failures }
}

async function run(options: TrustRetentionOptions, failures: TrustRetentionFailure[]): Promise<TrustRetentionOutcome> {
  const fs = options.fs ?? nodeFs
  const { directory } = options
  const step = async <T>(entry: string, name: TrustRetentionFailure["step"], action: () => Promise<T>): Promise<T> => {
    try {
      return await action()
    } catch (error) {
      throw new StepError({ entry, step: name, code: codeOf(error) })
    }
  }

  if (!safeDirectory(await step(".", "inspect", () => fs.lstat(directory)))) return { kind: "skipped", reason: "directory-unsafe", failures }
  const names = await step(".", "list", () => fs.readdir(directory))

  const leaseDirectory = join(directory, "leases")
  let leaseNames: string[] = []
  let leaseStat: TrustRetentionStat | null = null
  try {
    leaseStat = await fs.lstat(leaseDirectory)
  } catch (error) {
    if (!missing(error)) throw new StepError({ entry: "leases", step: "inspect", code: codeOf(error) })
  }
  if (leaseStat !== null) {
    if (!safeDirectory(leaseStat)) return { kind: "skipped", reason: "leases-unsafe", failures }
    leaseNames = await step("leases", "list", () => fs.readdir(leaseDirectory))
  }

  // A lease pins unless it is provably dead: unreadable content or a failed probe keeps its generation.
  const pinned = new Set<string>()
  const deadLeases: string[] = []
  const leases = await regularEntries(fs, leaseDirectory, leaseNames, LEASE, "leases/", "read-lease")
  failures.push(...leases.failures)
  for (const { entry, match, stat } of leases.found) {
    const [, generation, pidText] = match
    if (generation === undefined || pidText === undefined) continue
    if (stat === null) {
      pinned.add(generation)
      continue
    }
    let body: unknown
    try {
      body = JSON.parse(await readPrefix(fs, join(leaseDirectory, entry), LEASE_BYTES))
    } catch (error) {
      if (missing(error)) continue
      if (!(error instanceof SyntaxError)) {
        failures.push({ entry: `leases/${entry}`, step: "read-lease", code: codeOf(error) })
        pinned.add(generation)
        continue
      }
    }
    const fields = typeof body === "object" && body !== null ? body as Record<string, unknown> : {}
    const { v, pid, bootAtMs } = fields
    // A newer engine's lease may encode liveness differently: it cannot be proven dead here, so it pins, stays and is
    // reported, so an operator can tell why its generation never ages out.
    if (typeof v === "number" && Number.isInteger(v) && v > 1) {
      failures.push({ entry: `leases/${entry}`, step: "read-lease", code: "LEASE_NEWER_SCHEMA" })
      pinned.add(generation)
      continue
    }
    const wellFormed = v === 1 && typeof pid === "number" && Number.isSafeInteger(pid) && String(pid) === pidText
      && typeof bootAtMs === "number" && Number.isFinite(bootAtMs)
      && Math.abs(bootAtMs - options.bootAtMs) <= BOOT_INSTANT_TOLERANCE_MS
    let alive = false
    if (wellFormed) {
      try {
        alive = options.isPidAlive(pid)
      } catch (error) {
        failures.push({ entry: `leases/${entry}`, step: "probe-lease", code: codeOf(error) })
        alive = true
      }
    }
    if (alive) pinned.add(generation)
    else deadLeases.push(entry)
  }

  const removedLeases: string[] = []
  for (const entry of deadLeases) {
    try {
      await fs.unlink(join(leaseDirectory, entry))
      removedLeases.push(entry)
    } catch (error) {
      if (!missing(error)) failures.push({ entry: `leases/${entry}`, step: "remove-lease", code: codeOf(error) })
    }
  }

  // Recency is mtime: adoption and shim materialization refresh it (design 5.3 Retention).
  const generations = await regularEntries(fs, directory, names, GENERATION, "", "inspect-generation")
  failures.push(...generations.failures)
  let headersKnown = generations.found.every(({ stat }) => stat !== null)
  const ranked = generations.found
    .flatMap(({ match, stat }) => match[1] === undefined || stat === null ? [] : [{ digest: match[1], mtimeMs: stat.mtimeMs }])
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.digest.localeCompare(b.digest))
  const remaining: string[] = ranked.slice(0, RETAINED_GENERATIONS).map(({ digest }) => digest)
  const removedGenerations: string[] = []
  for (const { digest } of ranked.slice(RETAINED_GENERATIONS)) {
    if (pinned.has(digest) || digest === options.current) {
      remaining.push(digest)
      continue
    }
    try {
      await fs.unlink(join(directory, `${digest}.pem`))
      removedGenerations.push(digest)
    } catch (error) {
      if (missing(error)) continue
      failures.push({ entry: `${digest}.pem`, step: "remove-generation", code: codeOf(error) })
      remaining.push(digest)
    }
  }

  // A user-extras file goes only when no remaining header names it; an unreadable header might.
  const named = new Set<string>()
  for (const digest of remaining) {
    try {
      const user = HEADER.exec(await readPrefix(fs, join(directory, `${digest}.pem`), HEADER_BYTES))?.[1]
      if (user !== undefined && user !== "none") named.add(user)
    } catch (error) {
      if (missing(error)) continue
      failures.push({ entry: `${digest}.pem`, step: "read-header", code: codeOf(error) })
      headersKnown = false
    }
  }
  const removedUserExtras: string[] = []
  if (headersKnown) {
    const extras = await regularEntries(fs, directory, names, USER_EXTRAS, "", "remove-user-extras")
    failures.push(...extras.failures)
    for (const { entry, match, stat } of extras.found) {
      const digest = match[1]
      if (digest === undefined || stat === null || named.has(digest)) continue
      try {
        await fs.unlink(join(directory, entry))
        removedUserExtras.push(digest)
      } catch (error) {
        if (!missing(error)) failures.push({ entry, step: "remove-user-extras", code: codeOf(error) })
      }
    }
  }

  return {
    kind: "swept",
    removed: { generations: removedGenerations.sort(), leases: removedLeases.sort(), userExtras: removedUserExtras.sort() },
    failures,
  }
}

/**
 * Design 5.3 Retention. Removes a generation only when it is outside the 16 most recently used and
 * no live lease names it, removes dead leases in the same sweep, and removes a user-extras file only
 * when no remaining generation's header names it. `defaults/` and every other name are never touched.
 */
export async function sweepTrustRetention(options: TrustRetentionOptions): Promise<TrustRetentionOutcome> {
  const failures: TrustRetentionFailure[] = []
  try {
    return await run(options, failures)
  } catch (error) {
    failures.push(error instanceof StepError ? error.failure : { entry: ".", step: "unexpected", code: codeOf(error) })
    return { kind: "skipped", reason: "sweep-error", failures }
  }
}
