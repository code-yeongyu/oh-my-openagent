import { randomBytes } from "node:crypto"
import { mkdirSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { atomicReplace } from "../store/record-write"
import { withTaskRecordLock } from "../store/record-lock"
import { WorkpoolRecordSchema } from "./record-schema"
import { canonicalJson, parsePoolId } from "./schema"
import { WorkpoolError, type WorkpoolCaller, type WorkpoolCreate, type WorkpoolMode, type WorkpoolRecord, type WorkpoolSpec } from "./types"

export function createWorkpoolStore(stateDir: string) {
  const directory = join(stateDir, "workpools")
  const path = (poolId: string): string => join(directory, `${parsePoolId(poolId)}.json`)
  const pausePath = (poolId: string): string => join(directory, `${parsePoolId(poolId)}.pause.json`)
  function load(poolId: string): WorkpoolRecord {
    let bytes: string
    try { bytes = readFileSync(path(poolId), "utf8") }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new WorkpoolError("pool_not_found", "Pool not found.")
      throw error
    }
    try {
      const record = WorkpoolRecordSchema.parse(JSON.parse(bytes))
      if (record.pool_id !== poolId) throw new WorkpoolError("store_corrupt", "Pool identity does not match its file.")
      return withPause(record, readPauseSidecar(pausePath(poolId))[record.revision])
    } catch (error) {
      throw new WorkpoolError("store_corrupt", error instanceof Error ? error.message : "Invalid pool record.")
    }
  }
  // The pool file keeps the shape the previous release parses; pause state rides a sidecar that
  // release never lists. The sidecar is written first and keeps the previous revision, so a crash
  // between the two writes still reads a consistent pool.
  function write(record: WorkpoolRecord): void {
    const { base, pause } = splitPause(record)
    const prior = readPauseSidecar(pausePath(record.pool_id))
    const kept = Object.fromEntries(Object.entries(prior).filter(([revision]) => Number(revision) === record.revision - 1))
    const revisions = pause === undefined ? kept : { ...kept, [record.revision]: pause }
    if (Object.keys(revisions).length > 0 || Object.keys(prior).length > 0) {
      atomicReplace(pausePath(record.pool_id), JSON.stringify({ revisions }))
    }
    atomicReplace(path(record.pool_id), JSON.stringify(base))
  }
  function list(): readonly WorkpoolRecord[] {
    let names: string[]
    try { names = readdirSync(directory) }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
      throw error
    }
    return names.filter(name => /^wp_[0-9a-f]{32}\.json$/.test(name)).sort().map(name => load(name.slice(0, -5)))
  }
  function owned(caller: Pick<WorkpoolCaller, "sessionId">, poolId: string): WorkpoolRecord {
    const record = load(poolId)
    if (record.parent_session_id !== caller.sessionId) throw new WorkpoolError("scope_denied", "Only the owning parent session may access this pool.")
    return record
  }
  function mutate(poolId: string, update: (record: WorkpoolRecord) => WorkpoolRecord): WorkpoolRecord {
    return withTaskRecordLock(path(poolId), () => {
      const prior = load(poolId)
      const next = update(prior)
      if (next === prior) return prior
      const saved = { ...next, revision: prior.revision + 1 }
      write(saved)
      return saved
    })
  }
  function create(caller: WorkpoolCaller, input: WorkpoolCreate & { readonly mode: WorkpoolMode }, workerSpec: WorkpoolSpec): WorkpoolRecord {
    mkdirSync(directory, { recursive: true })
    // The directory lock serializes parent/name creation across hosts, not just this object.
    return withTaskRecordLock(join(directory, "names"), () => {
      const existing = list().find(pool => pool.parent_session_id === caller.sessionId && pool.name === input.name)
      if (existing !== undefined) {
        const same = canonicalJson(z.json().parse(existing.agent)) === canonicalJson(z.json().parse(input.agent)) && existing.mode === input.mode &&
          canonicalJson(z.json().parse(existing.worker_spec)) === canonicalJson(z.json().parse(workerSpec)) &&
          sameGrant(existing.kernel_tool_names, input.tools)
        if (!same || existing.status !== "open") throw new WorkpoolError("pool_name_conflict", "Pool name is already in use; choose a new explicit name.")
        return existing
      }
      const record: WorkpoolRecord = {
        version: 1, pool_id: `wp_${randomBytes(16).toString("hex")}`, name: input.name,
        parent_session_id: caller.sessionId, root_session_id: caller.rootSessionId, generation: 1, revision: 0,
        mode: input.mode, agent: input.agent, worker_spec: workerSpec, status: "open", items: [], workers: [],
        // Plain-data names only: the parent closures and their descriptors are runtime state.
        ...(input.tools === undefined || input.tools.length === 0 ? {} : { kernel_tool_names: [...input.tools] }),
      }
      write(record)
      return load(record.pool_id)
    })
  }
  return { load, list, owned, mutate, create }
}
export type WorkpoolStore = ReturnType<typeof createWorkpoolStore>

const PauseStateSchema = z.strictObject({
  hold: z.strictObject({ reason: z.literal("user_stop"), pauseSeq: z.number().int().positive() }).optional(),
  paused_workers: z.array(z.string()),
  entry_ids: z.record(z.string(), z.array(z.string())),
})
type PauseState = z.infer<typeof PauseStateSchema>
const PauseSidecarSchema = z.strictObject({ revisions: z.record(z.string(), PauseStateSchema) })

function readPauseSidecar(path: string): Readonly<Record<string, PauseState>> {
  let bytes: string
  try { bytes = readFileSync(path, "utf8") }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {}
    throw error
  }
  return PauseSidecarSchema.parse(JSON.parse(bytes)).revisions
}

function splitPause(record: WorkpoolRecord): { readonly base: WorkpoolRecord; readonly pause?: PauseState } {
  const { hold, ...rest } = record
  const pausedWorkers = record.workers.filter(worker => worker.status === "paused").map(worker => worker.task_id)
  const entryIds = Object.fromEntries(record.items.flatMap(item =>
    item.delivery?.entry_ids === undefined ? [] : [[item.item_id, [...item.delivery.entry_ids]]]))
  const base: WorkpoolRecord = {
    ...rest,
    workers: record.workers.map(worker => worker.status === "paused" ? { ...worker, status: "busy" } : worker),
    items: record.items.map(item => {
      if (item.delivery?.entry_ids === undefined) return item
      const { entry_ids: _entryIds, ...delivery } = item.delivery
      return { ...item, delivery }
    }),
  }
  if (hold === undefined && pausedWorkers.length === 0 && Object.keys(entryIds).length === 0) return { base }
  return { base, pause: { ...(hold === undefined ? {} : { hold }), paused_workers: pausedWorkers, entry_ids: entryIds } }
}

function withPause(record: WorkpoolRecord, pause: PauseState | undefined): WorkpoolRecord {
  if (pause === undefined) return record
  const paused = new Set(pause.paused_workers)
  return {
    ...record,
    ...(pause.hold === undefined ? {} : { hold: pause.hold }),
    workers: record.workers.map(worker => paused.has(worker.task_id) ? { ...worker, status: "paused" } : worker),
    items: record.items.map(item => {
      const entryIds = pause.entry_ids[item.item_id]
      return entryIds === undefined || item.delivery === undefined ? item : { ...item, delivery: { ...item.delivery, entry_ids: entryIds } }
    }),
  }
}

// A reused pool keeps the tools it was created with, so a same-name create must ask for exactly that grant.
function sameGrant(existing: readonly string[] | undefined, requested: readonly string[] | undefined): boolean {
  const left = [...new Set(existing ?? [])].sort()
  const right = [...new Set(requested ?? [])].sort()
  return left.length === right.length && left.every((name, index) => name === right[index])
}
