import { createHash, randomUUID } from "node:crypto"
import { copyFile, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve, sep } from "node:path"
import { acquireWithoutDirectorySweep, releaseLock } from "../memory-core/src/locks/acquire"
import { createLockRecord, parseLockRecord } from "../memory-core/src/locks/lock-record"
import { isLockOwnerProvenDead } from "../memory-core/src/locks/stale-owner"

export const UPDATE_PROTOCOL = 1
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*)?$/
const ASSET = /^omo-(?:linux|darwin|windows)-(?:x64|arm64)(?:-musl)?(?:-baseline)?(?:\.exe)?$/
const DIGEST = /^[0-9a-f]{64}$/
const ID = /^[0-9A-Za-z._-]+-[0-9a-f]{64}$/

export type Generation = {
  version: string
  asset: string
  digest: string
  protocol: number
  backwardCompatible: boolean
  payloadDigest?: string
}
export type InstallationRecord = {
  schema: 1
  id: string
  launcher: string
  launcherFingerprint: string
  bootstrapVersion?: string
  asset: string
  channel: "stable" | "beta"
  ownership: "standalone"
  selected?: string
  previous?: string
  staged?: { generation: string; source?: string }
  quarantine: Record<string, string>
  lastCheck?: number
  nextCheck?: number
  failures?: number
  reason?: string
}
type Journal = { schema: 1; before: InstallationRecord; after: InstallationRecord; bootstrap?: { temporary: string } }
type Checkpoint = "journal-publish" | "generation-published" | "journal-select" | "selection-committed"
type StoreOptions = { checkpoint?: (boundary: Checkpoint) => Promise<void> }

function code(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined
}

export function generationId(generation: Generation): string {
  if (!VERSION.test(generation.version) || !ASSET.test(generation.asset) || !DIGEST.test(generation.digest)
    || !Number.isSafeInteger(generation.protocol) || generation.protocol < 1
    || typeof generation.backwardCompatible !== "boolean") throw new Error("Invalid runtime generation")
  return `${generation.version}-${generation.asset}-${generation.digest}`
}

async function json(path: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) }
  catch (error) { if (code(error) === "ENOENT") return undefined; throw error }
}

async function syncDirectory(path: string): Promise<void> {
  // Windows does not expose directory fsync through Node. The file is flushed before rename.
  if (process.platform === "win32") return
  const fd = await open(path, "r")
  try { await fd.sync() } finally { await fd.close() }
}

async function syncPayload(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await syncPayload(path)
    else if (entry.isFile()) {
      const file = await open(path, "r")
      try { await file.sync() } finally { await file.close() }
    } else throw new Error("Runtime payload contains a non-regular entry")
  }
  await syncDirectory(directory)
}

/** Never unlink the destination: a sharing refusal leaves the last committed record intact. */
export async function writeUpdateRecord(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, "wx", 0o600)
    try { await file.writeFile(`${JSON.stringify(value)}\n`); await file.sync() }
    finally { await file.close() }
    await rename(temporary, path)
    await syncDirectory(dirname(path))
  } finally {
    await rm(temporary, { force: true })
  }
}

function parseRecord(value: unknown, launcher?: string): InstallationRecord {
  if (typeof value !== "object" || value === null) throw new Error("Invalid installation selection record")
  const r = value as InstallationRecord
  if (r.schema !== 1 || typeof r.id !== "string" || typeof r.launcher !== "string"
    || typeof r.launcherFingerprint !== "string"
    || (launcher !== undefined && r.launcher !== launcher) || !ASSET.test(r.asset)
    || !["stable", "beta"].includes(r.channel) || r.ownership !== "standalone"
    || typeof r.quarantine !== "object" || r.quarantine === null || Array.isArray(r.quarantine)
    || [r.selected, r.previous, r.staged?.generation, r.staged?.source].some((id) => id !== undefined && (typeof id !== "string" || !ID.test(id)))
    || (r.staged !== undefined && (typeof r.staged !== "object" || typeof r.staged.generation !== "string"))
    || Object.entries(r.quarantine).some(([key, reason]) => !ID.test(key) || typeof reason !== "string")
    || [r.lastCheck, r.nextCheck, r.failures].some((n) => n !== undefined && (!Number.isFinite(n) || n < 0))) {
    throw new Error("Invalid installation selection record")
  }
  return r
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").slice(0, 240)
}

/**
 * Installation mutations take installation.lock, then cache.lock. Publication, selection,
 * lease acquisition/release and collection all take cache.lock. Readers may use the last
 * committed record while an updater holds installation.lock across download or preflight.
 */
export class UpdateStore {
  readonly root: string
  readonly launcher: string
  readonly installKey: string
  readonly directory: string
  readonly lockPath: string
  readonly recordPath: string
  readonly journalPath: string

  constructor(root: string, canonicalLauncher: string, readonly options: StoreOptions = {}) {
    this.root = resolve(root)
    this.launcher = resolve(canonicalLauncher)
    this.installKey = createHash("sha256").update(this.launcher).digest("hex")
    this.directory = join(this.root, "installations", this.installKey)
    this.lockPath = join(this.directory, "transaction.lock")
    this.recordPath = join(this.directory, "selection.json")
    this.journalPath = join(this.directory, "journal.json")
  }

  async read(): Promise<InstallationRecord | undefined> {
    try {
      const value = await json(this.recordPath)
      if (value !== undefined) return parseRecord(value, this.launcher)
    } catch (error) {
      const previous = await json(join(this.directory, "previous-selection.json"))
      if (previous === undefined) throw error
      return parseRecord(previous, this.launcher)
    }
    const previous = await json(join(this.directory, "previous-selection.json"))
    return previous === undefined ? undefined : parseRecord(previous, this.launcher)
  }

  async launcherFingerprint(): Promise<string> {
    if (await realpath(this.launcher) !== this.launcher) throw new Error("Launcher identity changed")
    const file = await stat(this.launcher)
    return `${file.dev}:${file.ino}:${file.size}:${file.mtimeMs}`
  }

  async matchesLauncher(): Promise<boolean> {
    const record = await this.read()
    return record === undefined || record.launcherFingerprint === await this.launcherFingerprint()
  }

  generationPath(id: string): string {
    if (!ID.test(id)) throw new Error("Invalid generation identity")
    return join(this.root, "generations", id)
  }

  async generation(id: string, verify = true): Promise<Generation> {
    const directory = this.generationPath(id)
    const value = await json(join(directory, "generation.json")) as Generation | undefined
    if (value === undefined || generationId(value) !== id) throw new Error("Runtime generation is incomplete")
    const executable = join(directory, value.asset.endsWith(".exe") ? "omo.exe" : "omo")
    if (!(await stat(executable)).isFile()) throw new Error("Runtime executable is missing")
    if (!verify) return value
    if (createHash("sha256").update(await readFile(executable)).digest("hex") !== value.digest) throw new Error("Runtime executable checksum mismatch")
    if (value.payloadDigest !== undefined) {
      const raw = await readFile(join(directory, "runtime-manifest.json"))
      if (createHash("sha256").update(raw).digest("hex") !== value.payloadDigest) throw new Error("Runtime payload manifest checksum mismatch")
      const manifest = JSON.parse(raw.toString()) as { entries?: { relPath: string; sha256: string; size: number }[] }
      if (!Array.isArray(manifest.entries)) throw new Error("Invalid runtime payload manifest")
      for (const entry of manifest.entries) {
        if (typeof entry.relPath !== "string" || isAbsolute(entry.relPath)
          || !resolve(directory, entry.relPath).startsWith(`${directory}${sep}`)) throw new Error("Runtime payload path escapes its generation")
        const bytes = await readFile(join(directory, entry.relPath))
        if (bytes.length !== entry.size || createHash("sha256").update(bytes).digest("hex") !== entry.sha256) {
          throw new Error(`Runtime payload checksum mismatch: ${entry.relPath}`)
        }
      }
    }
    return value
  }

  async createStaging(): Promise<string> {
    const staging = join(this.root, "staging")
    await mkdir(staging, { recursive: true, mode: 0o700 })
    return mkdtemp(join(staging, "candidate-"))
  }

  async locked<T>(path: string, work: () => Promise<T>, waitTimeoutMs = 0): Promise<T> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 })
    const owner = await createLockRecord("compiled-update")
    // The lock is atomically published with complete owner metadata. A malformed legacy
    // lock is uncertain, not a dead owner, regardless of its age.
    await acquireWithoutDirectorySweep(path, owner, { waitTimeoutMs, incompleteLockGraceMs: Infinity })
    try { return await work() } finally { await releaseLock(path, owner) }
  }

  cache<T>(work: () => Promise<T>): Promise<T> {
    return this.locked(join(this.root, "cache.lock"), work, 2000)
  }

  async transaction<T>(work: (transaction: UpdateTransaction) => Promise<T>, options: { waitTimeoutMs?: number } = {}): Promise<T> {
    return this.locked(this.lockPath, async () => {
      const transaction = new UpdateTransaction(this)
      await transaction.recover()
      return work(transaction)
    }, options.waitTimeoutMs)
  }

  async lease(id: string): Promise<{ nonce: string; directory: string; release: () => Promise<void> }> {
    const owner = await createLockRecord(`compiled-runtime-use:${this.installKey}`)
    const path = join(this.root, "leases", id, `${owner.nonce}.json`)
    await this.cache(async () => {
      await this.generation(id, false)
      await writeUpdateRecord(path, owner)
    })
    try { await this.generation(id) }
    catch (error) {
      await this.cache(() => rm(path, { force: true }))
      throw error
    }
    return {
      nonce: owner.nonce,
      directory: this.generationPath(id),
      release: async () => {
        await this.cache(async () => {
          const current = parseLockRecord(await readFile(path, "utf8"))
          if (current?.nonce === owner.nonce) await rm(path)
        })
      },
    }
  }

  /** Selection and registration are one GC barrier; no read-then-delete window. */
  async selectedLease(): Promise<{ id: string; nonce: string; directory: string; release: () => Promise<void> } | undefined> {
    const owner = await createLockRecord(`compiled-runtime-use:${this.installKey}`)
    let id: string | undefined
    for (const field of ["selected", "previous"] as const) {
      await this.cache(async () => {
        const candidate = (await this.read())?.[field]
        if (!candidate) return
        try { await this.generation(candidate, false) } catch { return }
        id = candidate
        await writeUpdateRecord(join(this.root, "leases", candidate, `${owner.nonce}.json`), owner)
      })
      if (id === undefined) continue
      try { await this.generation(id); break }
      catch {
        const invalid = join(this.root, "leases", id, `${owner.nonce}.json`)
        await this.cache(() => rm(invalid, { force: true }))
        id = undefined
      }
    }
    if (id === undefined) return undefined
    const path = join(this.root, "leases", id, `${owner.nonce}.json`)
    return {
      id, nonce: owner.nonce, directory: this.generationPath(id),
      release: () => this.cache(async () => {
        const current = parseLockRecord(await readFile(path, "utf8"))
        if (current?.nonce === owner.nonce) await rm(path)
      }),
    }
  }
}

export class UpdateTransaction {
  constructor(readonly store: UpdateStore) {}

  async initialize(identity: Pick<InstallationRecord, "asset" | "channel" | "ownership" | "bootstrapVersion">): Promise<InstallationRecord> {
    if (await realpath(this.store.launcher) !== this.store.launcher) throw new Error("Launcher identity changed")
    const record = await this.store.read()
    if (record !== undefined) {
      if (record.asset !== identity.asset || record.channel !== identity.channel || identity.ownership !== "standalone") {
        throw new Error("Installation ownership, asset or channel changed")
      }
      return record
    }
    const initial: InstallationRecord = {
      schema: 1, id: randomUUID(), launcher: this.store.launcher,
      launcherFingerprint: await this.store.launcherFingerprint(), ...identity, quarantine: {},
    }
    parseRecord(initial, this.store.launcher)
    await this.store.cache(() => writeUpdateRecord(this.store.recordPath, initial))
    return initial
  }

  async record(): Promise<InstallationRecord> {
    const record = await this.store.read()
    if (record === undefined) throw new Error("Installation has not been enrolled")
    if (!(await this.store.matchesLauncher())) throw new Error("Launcher identity changed; re-enroll the installation")
    return record
  }

  async recover(): Promise<void> {
    await this.store.cache(async () => {
      const raw = await json(this.store.journalPath)
      if (raw === undefined) return
      if (typeof raw !== "object" || raw === null || (raw as Journal).schema !== 1) throw new Error("Invalid update journal")
      const journal = raw as Journal
      const before = parseRecord(journal.before, this.store.launcher)
      const after = parseRecord(journal.after, this.store.launcher)
      if (before.id !== after.id) throw new Error("Update journal installation changed")
      const current = await this.store.read()
      if (journal.bootstrap !== undefined) {
        const temporary = journal.bootstrap.temporary
        if (typeof temporary !== "string" || !temporary.startsWith(`${this.store.launcher}.update-`)
          || dirname(temporary) !== dirname(this.store.launcher)) throw new Error("Invalid bootstrap journal path")
        const fingerprint = await this.store.launcherFingerprint()
        if (fingerprint !== before.launcherFingerprint && fingerprint !== after.launcherFingerprint) {
          throw new Error("Bootstrap changed outside its pending transaction")
        }
        if (fingerprint === after.launcherFingerprint) {
          await writeUpdateRecord(join(this.store.directory, "previous-selection.json"), {
            ...before, launcherFingerprint: after.launcherFingerprint, bootstrapVersion: after.bootstrapVersion,
          })
        }
        await writeUpdateRecord(this.store.recordPath, fingerprint === after.launcherFingerprint ? after : before)
        await rm(temporary, { force: true })
        await rm(this.store.journalPath)
        await syncDirectory(this.store.directory)
        return
      }
      // A completed selection is preserved; an uncommitted activation never happens in
      // recovery. A published staged payload may be retained for next-launch preflight.
      if (JSON.stringify(current) !== JSON.stringify(after)) {
        let recovered = before
        if (after.selected === before.selected && after.staged !== undefined) {
          try { await this.store.generation(after.staged.generation); recovered = after }
          catch { /* Incomplete publication: keep the last committed selection. */ }
        }
        await writeUpdateRecord(this.store.recordPath, recovered)
      }
      await rm(this.store.journalPath)
      await syncDirectory(this.store.directory)
    })
  }

  async publish(staging: string, generation: Generation, retry = false): Promise<void> {
    const id = generationId(generation)
    const before = await this.record()
    if (generation.asset !== before.asset) throw new Error("Candidate has the wrong release asset")
    if (before.quarantine[id] && !retry) throw new Error(`Candidate quarantined: ${before.quarantine[id]}`)
    if (before.selected !== undefined) {
      const current = await this.store.generation(before.selected)
      if (Bun.semver.order(generation.version, current.version) <= 0) throw new Error("Candidate is not a newer release")
    }
    const stagingRoot = await realpath(join(this.store.root, "staging"))
    if (dirname(await realpath(staging)) !== stagingRoot) throw new Error("Candidate is outside the private staging directory")
    await writeUpdateRecord(join(staging, "generation.json"), generation)
    await syncPayload(staging)
    const after: InstallationRecord = { ...before, staged: { generation: id, source: before.selected } }
    await this.store.cache(async () => {
      await writeUpdateRecord(this.store.journalPath, { schema: 1, before, after } satisfies Journal)
      await this.store.options.checkpoint?.("journal-publish")
      const destination = this.store.generationPath(id)
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      if (await json(join(destination, "generation.json")) === undefined) {
        await rename(staging, destination)
        await syncDirectory(dirname(destination))
      } else {
        await this.store.generation(id)
        await rm(staging, { recursive: true })
      }
      await this.store.options.checkpoint?.("generation-published")
      await writeUpdateRecord(this.store.recordPath, after)
      await rm(this.store.journalPath)
      await syncDirectory(this.store.directory)
    })
  }

  async select(preflight: (directory: string, generation: Generation) => Promise<void>): Promise<boolean> {
    const before = await this.record()
    if (before.staged === undefined) return false
    const id = before.staged.generation
    if (before.staged.source !== before.selected) throw new Error("Candidate was staged for a different source generation")
    const generation = await this.store.generation(id)
    if (generation.protocol !== UPDATE_PROTOCOL) throw new Error("Candidate requires a bootstrap protocol upgrade")
    if (!generation.backwardCompatible && before.selected !== undefined) throw new Error("Candidate does not declare rollback compatibility")
    const lease = await this.store.lease(id)
    try {
      await preflight(lease.directory, generation)
    } catch (error) {
      const failed: InstallationRecord = { ...before, staged: undefined, quarantine: { ...before.quarantine, [id]: message(error) }, reason: message(error) }
      await this.store.cache(() => writeUpdateRecord(this.store.recordPath, failed))
      throw error
    } finally { await lease.release() }
    const after: InstallationRecord = { ...before, selected: id, previous: before.selected, staged: undefined, reason: undefined }
    await this.commit(before, after)
    return true
  }

  async commit(before: InstallationRecord, after: InstallationRecord): Promise<void> {
    await this.store.cache(async () => {
      if (before.selected) await writeUpdateRecord(join(this.store.directory, "previous-selection.json"), before)
      await writeUpdateRecord(this.store.journalPath, { schema: 1, before, after } satisfies Journal)
      await this.store.options.checkpoint?.("journal-select")
      await writeUpdateRecord(this.store.recordPath, after)
      await this.store.options.checkpoint?.("selection-committed")
      await rm(this.store.journalPath)
      await syncDirectory(this.store.directory)
    })
  }

  async rollback(): Promise<void> {
    const before = await this.record()
    if (before.previous === undefined) throw new Error("No verified previous generation")
    const current = before.selected === undefined ? undefined : await this.store.generation(before.selected)
    if (current && !current.backwardCompatible) throw new Error("Selected release requires manual state recovery")
    await this.store.generation(before.previous)
    await this.commit(before, { ...before, selected: before.previous, previous: before.selected, staged: undefined })
  }

  async updateStatus(status: Pick<InstallationRecord, "lastCheck" | "nextCheck" | "failures" | "reason">): Promise<void> {
    const before = await this.record()
    await this.store.cache(() => writeUpdateRecord(this.store.recordPath, { ...before, ...status }))
  }

  /** Only a separate generation process calls this after its external bootstrap exits. */
  async maintainBootstrap(preflight: (directory: string, generation: Generation) => Promise<void>, ownPid = process.pid): Promise<boolean> {
    const before = await this.record()
    if (!before.staged) return false
    const id = before.staged.generation
    const candidate = await this.store.generation(id)
    if (candidate.protocol === UPDATE_PROTOCOL) return false
    if (!candidate.backwardCompatible) throw new Error("Bootstrap candidate has no rollback compatibility declaration")
    await preflight(this.store.generationPath(id), candidate)
    return this.store.cache(async () => {
      const leaseRoot = join(this.store.root, "leases")
      let generations: string[]
      try { generations = await readdir(leaseRoot) } catch (error) { if (code(error) !== "ENOENT") throw error; generations = [] }
      for (const generation of generations) {
        for (const name of await readdir(join(leaseRoot, generation))) {
          const owner = parseLockRecord(await readFile(join(leaseRoot, generation, name), "utf8"))
          if (owner === null) return false
          if (owner.purpose !== `compiled-runtime-use:${this.store.installKey}` || owner.pid === ownPid) continue
          if (!(await isLockOwnerProvenDead(owner))) return false
        }
      }
      // The previous executable remains in the immutable previous generation. Copy
      // to a sibling and rename over the pathname; never write into a mapped image.
      // Windows sharing refusal leaves the old pathname and selection untouched.
      const temporary = `${this.store.launcher}.update-${randomUUID()}`
      try {
        await copyFile(join(this.store.generationPath(id), candidate.asset.endsWith(".exe") ? "omo.exe" : "omo"), temporary)
        const file = await open(temporary, "r")
        try { await file.sync() } finally { await file.close() }
        const info = await stat(temporary)
        const after: InstallationRecord = {
          ...before, launcherFingerprint: `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`,
          bootstrapVersion: candidate.version, selected: id, previous: before.selected, staged: undefined, reason: undefined,
        }
        await writeUpdateRecord(this.store.journalPath, { schema: 1, before, after, bootstrap: { temporary } } satisfies Journal)
        await rename(temporary, this.store.launcher)
        await syncDirectory(dirname(this.store.launcher))
        await writeUpdateRecord(join(this.store.directory, "previous-selection.json"), {
          ...before, launcherFingerprint: after.launcherFingerprint, bootstrapVersion: after.bootstrapVersion,
        })
        await writeUpdateRecord(this.store.recordPath, after)
        await rm(this.store.journalPath)
        await syncDirectory(this.store.directory)
        return true
      } finally {
        // Recovery decides from the actual file identity whether the rename committed.
        // Never delete selection.json to get around Windows sharing.
        await rm(temporary, { force: true })
      }
    })
  }

  async gc(): Promise<string[]> {
    return this.store.cache(async () => {
      const keep = new Set<string>()
      const retain = (record: InstallationRecord) => {
        for (const id of [record.selected, record.previous, record.staged?.generation, record.staged?.source]) if (id) keep.add(id)
      }
      // Any unreadable or malformed installation/journal aborts collection. No guessed keep set.
      for (const install of await readdir(join(this.store.root, "installations"))) {
        const directory = join(this.store.root, "installations", install)
        const record = await json(join(directory, "selection.json"))
        if (record !== undefined) retain(parseRecord(record))
        const previous = await json(join(directory, "previous-selection.json"))
        if (previous !== undefined) retain(parseRecord(previous))
        const journal = await json(join(directory, "journal.json")) as Journal | undefined
        if (journal !== undefined) {
          if (journal.schema !== 1) throw new Error("Invalid update journal")
          retain(parseRecord(journal.before))
          retain(parseRecord(journal.after))
        }
      }
      const generations = join(this.store.root, "generations")
      let entries: string[]
      try { entries = await readdir(generations) } catch (error) { if (code(error) === "ENOENT") return []; throw error }
      const removed: string[] = []
      for (const id of entries) {
        if (!ID.test(id)) continue
        const leases = join(this.store.root, "leases", id)
        let names: string[]
        try { names = await readdir(leases) } catch (error) { if (code(error) !== "ENOENT") throw error; names = [] }
        let inUse = false
        for (const name of names) {
          const path = join(leases, name)
          const owner = parseLockRecord(await readFile(path, "utf8"))
          if (owner === null || !(await isLockOwnerProvenDead(owner))) inUse = true
          else await rm(path)
        }
        if (inUse || keep.has(id)) continue
        // Never rename: after the shared lease barrier, no process can acquire this
        // generation while its directory is being deleted.
        await rm(this.store.generationPath(id), { recursive: true })
        await rm(leases, { recursive: true, force: true })
        removed.push(id)
      }
      return removed
    })
  }
}
