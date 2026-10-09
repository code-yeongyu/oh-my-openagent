// Last commit time per path at a revision, kept incremental across revisions and processes.
//
// A full `git log --name-only` over a long-lived memory repo costs seconds (12k commits measured ~9 s),
// and the compiled block needs these times at every new HEAD of every session. Memory history only
// grows, so the next revision is almost always a descendant of one already computed: only the commits
// in between are read. The newest computed answer is kept in the common git dir for the next process.
//
// The kept map is UNFILTERED: every path any reachable commit touched, with its newest time. A path that
// is deleted and later re-added therefore keeps its older touches, and an incremental answer equals a
// full walk exactly (reach(rev) = reach(base) + base..rev, and the max over a union is the max of maxes).

import { randomUUID } from "node:crypto"
import { isAbsolute, join } from "node:path"
import { readFile, rename, rm, writeFile } from "../fs/resilient"
import type { GitRevisionRunner } from "./repo-revision-reads"

const CACHE_SIZE = 4
const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const COMMIT_MARK = "\x01"
const STORE_NAME = "omo-path-commit-times.json"
const STORE_VERSION = 2
/** A full walk runs once per repo (the store keeps its result); it must not hit the 30 s default. */
const FULL_WALK_TIMEOUT_MS = 300_000

type Times = ReadonlyMap<string, number>
interface Computed {
  readonly all: Times
  readonly live: Times
}

export class PathCommitTimes {
  private readonly computed = new Map<string, Promise<Computed>>()

  constructor(
    private readonly dir: string,
    private readonly git: GitRevisionRunner,
    private readonly lsTree: (revision: string) => Promise<readonly string[]>,
  ) {}

  /**
   * Epoch-second time of the newest commit touching each path present at `revision`. Renames are not
   * followed: the compiled tree is what is listed. A merge counts the paths it changed against its first
   * parent. The answer depends only on the revision; a full object id is kept (four revisions, least
   * recently used) and a symbolic revision is resolved first.
   */
  async at(revision: string): Promise<Times> {
    const oid = FULL_OBJECT_ID.test(revision) ? revision : await this.resolve(revision)
    const cached = this.computed.get(oid)
    if (cached !== undefined) {
      this.computed.delete(oid)
      this.computed.set(oid, cached)
      return (await cached).live
    }
    const bases = [...this.computed.entries()].reverse()
    const pending = this.compute(oid, bases)
    this.computed.set(oid, pending)
    pending.catch(() => {
      if (this.computed.get(oid) === pending) this.computed.delete(oid)
    })
    const oldest = this.computed.keys().next().value
    if (this.computed.size > CACHE_SIZE && oldest !== undefined) this.computed.delete(oldest)
    return (await pending).live
  }

  private async resolve(revision: string): Promise<string> {
    return (await this.git.run(["rev-parse", "--verify", `${revision}^{commit}`])).stdout.trim()
  }

  private async compute(oid: string, bases: ReadonlyArray<readonly [string, Promise<Computed>]>): Promise<Computed> {
    const present = await this.lsTree(oid)
    const all = await this.reachableTimes(oid, bases)
    return { all, live: liveTimes(present, all) }
  }

  private async reachableTimes(oid: string, bases: ReadonlyArray<readonly [string, Promise<Computed>]>): Promise<Times> {
    const stored = await this.readStore()
    const candidates: Array<readonly [string, () => Promise<Times | null>]> = [
      ...bases.map(([base, computed]) => [base, () => computed.then((value) => value.all, () => null)] as const),
      ...(stored === null ? [] : [[stored.revision, async () => stored.times] as const]),
    ]
    for (const [base, load] of candidates) {
      if (base === oid) {
        const times = await load()
        if (times !== null) return times
        continue
      }
      if (!(await this.isAncestor(base, oid))) continue
      const times = await load()
      if (times === null) continue
      const result = maxTimes(times, parseLogTimes((await this.log([`${base}..${oid}`])).stdout))
      if (base === stored?.revision) await this.writeStore(oid, result)
      return result
    }
    const result = parseLogTimes((await this.log([oid], FULL_WALK_TIMEOUT_MS)).stdout)
    if (stored === null || (await this.isAncestor(stored.revision, oid))) await this.writeStore(oid, result)
    return result
  }

  private log(range: readonly string[], timeoutMs?: number): ReturnType<GitRevisionRunner["run"]> {
    return this.git.run([
      "log", "--format=%x01%ct", "--name-only", "-z", "--no-renames", "--diff-merges=first-parent",
      "--diff-filter=d", ...range, "--",
    ], timeoutMs)
  }

  private async isAncestor(ancestor: string, descendant: string): Promise<boolean> {
    return (await this.git.result(["merge-base", "--is-ancestor", ancestor, descendant])).code === 0
  }

  private async storePath(): Promise<string> {
    const common = (await this.git.run(["rev-parse", "--git-common-dir"])).stdout.trim()
    return join(isAbsolute(common) ? common : join(this.dir, common), STORE_NAME)
  }

  /** A missing, unreadable or malformed store, or one with any invalid entry, is treated as absent. */
  private async readStore(): Promise<{ readonly revision: string; readonly times: Times } | null> {
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(await this.storePath(), "utf8"))
    } catch {
      return null
    }
    if (typeof parsed !== "object" || parsed === null) return null
    const { version, revision, times } = parsed as { version?: unknown; revision?: unknown; times?: unknown }
    if (version !== STORE_VERSION || typeof revision !== "string" || !FULL_OBJECT_ID.test(revision)) return null
    if (typeof times !== "object" || times === null || Array.isArray(times)) return null
    const entries = Object.entries(times)
    if (!entries.every((entry) => Number.isSafeInteger(entry[1]))) return null
    return { revision, times: new Map(entries as Array<[string, number]>) }
  }

  /** The store only saves a later walk: a failed write leaves every answer correct, so it never fails one. */
  private async writeStore(revision: string, times: Times): Promise<void> {
    let temp: string | undefined
    try {
      const path = await this.storePath()
      temp = `${path}.${process.pid}.${randomUUID()}.tmp`
      await writeFile(temp, `${JSON.stringify({ version: STORE_VERSION, revision, times: Object.fromEntries(times) })}\n`, "utf8")
      await rename(temp, path)
    } catch {
      if (temp !== undefined) await rm(temp, { force: true }).catch(() => undefined)
    }
  }
}

/** Newest commit time per path in a log range; git may list a child before an older-dated parent. */
function parseLogTimes(stdout: string): Map<string, number> {
  const times = new Map<string, number>()
  let committedAt = Number.NaN
  for (const token of stdout.split("\0")) {
    if (token.startsWith(COMMIT_MARK)) {
      committedAt = Number.parseInt(token.slice(1), 10)
      continue
    }
    const path = token.replace(/^\n/, "")
    if (path.length === 0 || !Number.isSafeInteger(committedAt)) continue
    times.set(path, Math.max(times.get(path) ?? committedAt, committedAt))
  }
  return times
}

function maxTimes(base: Times, added: Times): Times {
  const merged = new Map(base)
  for (const [path, time] of added) merged.set(path, Math.max(merged.get(path) ?? time, time))
  return merged
}

function liveTimes(present: readonly string[], all: Times): Times {
  const times = new Map<string, number>()
  for (const path of present) {
    const time = all.get(path)
    if (time !== undefined) times.set(path, time)
  }
  return times
}
