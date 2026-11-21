// Persisted compiled-memory values: a new process takes the compiled memory block (and the other values derived
// from one commit, such as its token estimate) from the memory repo's git dir instead of listing the tree, reading
// blobs and walking history again (about 94 ms warm and 3.5 s on a cold pack at ~6.9k notes). A derived cache, never
// a source of truth:
//   - each entry is keyed by a digest of every input its value is computed from, so it is either that value or
//     ignored; the caller owns the key;
//   - lives in `.git/`, so it is never in a commit and so never pushed, mirrored or synced;
//   - a missing, unreadable, corrupt or foreign entry reads as absent and is rewritten;
//   - written atomically (temp file + rename) off the caller's path, under the repository's exclusive gate.

import { createHash, randomUUID } from "node:crypto"
import { join } from "node:path"

import { readdir, readFile, rename, rm, stat, writeFile } from "../fs/resilient"
import { isRecallTermSaveExcluded, trackRecallTermSave } from "../recall/bm25-persist-gate"

export const MEMORY_BLOCK_STORE_PREFIX = "omo-memory-block-"
const FORMAT_VERSION = 1
/**
 * Entries kept per repository, shared by every identity, limits setting and value kind (a block and an estimate per
 * commit): the newest commits' entries are all a session or a relaunch reads.
 */
const KEEP_ENTRIES = 32
/** A temp file this old belongs to a write whose process died before its rename. */
const STALE_TEMP_MS = 10 * 60_000

interface StoredEntry {
  readonly version: number
  readonly key: string
  readonly value: string
}

function entryName(key: string): string {
  return `${MEMORY_BLOCK_STORE_PREFIX}${createHash("sha256").update(key).digest("hex")}.json`
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}

function decode(text: string, key: string): string | undefined {
  try {
    const entry = JSON.parse(text) as Partial<StoredEntry>
    return entry.version === FORMAT_VERSION && entry.key === key && typeof entry.value === "string" ? entry.value : undefined
  } catch {
    return undefined
  }
}

/** One memory repository's persisted compiled values; one instance per repository directory. */
export class CompiledBlockStore {
  private readonly writes = new Set<Promise<void>>()

  constructor(
    readonly dir: string,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** The value stored under `key`, or `undefined` when there is none or it is not readable as one. */
  async get(key: string): Promise<string | undefined> {
    const gitDir = await this.gitDir()
    if (gitDir === undefined) return undefined
    try {
      return decode(await readFile(join(gitDir, entryName(key)), "utf8"), key)
    } catch (error) {
      if (!isMissing(error)) this.onError(error)
      return undefined
    }
  }

  /** Stores `value` under `key` in the background; skipped while a restore holds the repository's gate. */
  put(key: string, value: string): void {
    if (isRecallTermSaveExcluded(this.dir)) return
    const write = this.write(key, value).catch((error: unknown) => this.onError(error))
    const tracked = write.finally(() => this.writes.delete(tracked))
    this.writes.add(tracked)
    trackRecallTermSave(this.dir, tracked)
  }

  /** Settles once no write is running; writes never reject. */
  async settled(): Promise<void> {
    while (this.writes.size > 0) await Promise.all([...this.writes])
  }

  /** `.git` when it is a directory; a worktree or submodule checkout (`.git` is a file) keeps no store. */
  private async gitDir(): Promise<string | undefined> {
    const gitDir = join(this.dir, ".git")
    try {
      return (await stat(gitDir)).isDirectory() ? gitDir : undefined
    } catch {
      return undefined
    }
  }

  private async write(key: string, value: string): Promise<void> {
    // Yield first: the write is requested on the caller's path, which must not wait for it.
    await new Promise<void>((resolve) => setImmediate(resolve))
    const gitDir = await this.gitDir()
    if (gitDir === undefined || isRecallTermSaveExcluded(this.dir)) return
    const path = join(gitDir, entryName(key))
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify({ version: FORMAT_VERSION, key, value } satisfies StoredEntry))
      if (isRecallTermSaveExcluded(this.dir)) {
        await rm(temp, { force: true })
        return
      }
      await rename(temp, path)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
    await prune(gitDir)
  }
}

/** Keeps the newest `KEEP_ENTRIES` entries and removes temp files of writes that died before their rename. */
async function prune(gitDir: string): Promise<void> {
  const entries: Array<{ readonly path: string; readonly mtimeMs: number }> = []
  for (const name of await readdir(gitDir)) {
    if (!name.startsWith(MEMORY_BLOCK_STORE_PREFIX)) continue
    const path = join(gitDir, name)
    const info = await stat(path).catch(() => undefined)
    if (info === undefined) continue
    if (name.endsWith(".tmp")) {
      if (Date.now() - info.mtimeMs > STALE_TEMP_MS) await rm(path, { force: true })
      continue
    }
    entries.push({ path, mtimeMs: info.mtimeMs })
  }
  entries.sort((left, right) => right.mtimeMs - left.mtimeMs)
  for (const stale of entries.slice(KEEP_ENTRIES)) await rm(stale.path, { force: true })
}
