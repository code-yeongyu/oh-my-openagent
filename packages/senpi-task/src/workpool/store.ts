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
  mkdirSync(directory, { recursive: true })
  const path = (poolId: string): string => join(directory, `${parsePoolId(poolId)}.json`)
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
      return record
    } catch (error) {
      throw new WorkpoolError("store_corrupt", error instanceof Error ? error.message : "Invalid pool record.")
    }
  }
  function list(): readonly WorkpoolRecord[] {
    return readdirSync(directory).filter(name => /^wp_[0-9a-f]{32}\.json$/.test(name)).sort().map(name => load(name.slice(0, -5)))
  }
  function owned(caller: WorkpoolCaller, poolId: string): WorkpoolRecord {
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
      atomicReplace(path(poolId), JSON.stringify(saved))
      return saved
    })
  }
  function create(caller: WorkpoolCaller, input: WorkpoolCreate & { readonly mode: WorkpoolMode }, workerSpec: WorkpoolSpec): WorkpoolRecord {
    // The directory lock serializes parent/name creation across hosts, not just this object.
    return withTaskRecordLock(join(directory, "names"), () => {
      const existing = list().find(pool => pool.parent_session_id === caller.sessionId && pool.name === input.name)
      if (existing !== undefined) {
        const same = canonicalJson(z.json().parse(existing.agent)) === canonicalJson(z.json().parse(input.agent)) && existing.mode === input.mode &&
          canonicalJson(z.json().parse(existing.worker_spec)) === canonicalJson(z.json().parse(workerSpec))
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
      atomicReplace(path(record.pool_id), JSON.stringify(record))
      return load(record.pool_id)
    })
  }
  return { load, list, owned, mutate, create }
}
export type WorkpoolStore = ReturnType<typeof createWorkpoolStore>
