import { dirname, resolve } from "node:path"

import { withTaskRecordLockAsync } from "../../store/record-lock"
import { DURABLE_JSON_FS, DURABLE_JSON_LOCK_OPTIONS, isRecord, type DurableJsonFs } from "./durable-json"
import { parseShardBasename, shardMetaPath, type ShardKind, type ShardNotice } from "./shard-socket"

/**
 * A shard's `.meta.json` sidecar: who the endpoint belongs to and which task stores opened children
 * on it. It is informational - the agent-dir store index is authoritative - so a sidecar written by
 * the Desktop (`stores: []`) or by an older build (no `stores`) is upgraded in place, never refused.
 */

export interface ShardOwner {
  readonly kind: "p"
  readonly key: string
  readonly ownerSessionId: string
  readonly ownerSessionFile?: string
}

export interface ShardSidecar {
  readonly socket: string
  readonly kind: ShardKind
  readonly root: string
  readonly owner_session_id?: string
  readonly owner_session_file?: string
  readonly created_at: string
  readonly created_by_pid: number
  readonly notice?: ShardNotice
  readonly stores: readonly string[]
}

export function shardSidecarPath(socket: string): string | undefined {
  const parsed = parseShardBasename(socket)
  return parsed === null ? undefined : shardMetaPath(dirname(socket), parsed.kind, parsed.key)
}

export interface WriteStartedSidecarInput {
  readonly socket: string
  readonly owner?: ShardOwner
  readonly notice?: ShardNotice
  readonly now: () => number
  readonly pid: number
  readonly fs?: DurableJsonFs
}

export async function writeStartedShardSidecar(input: WriteStartedSidecarInput): Promise<void> {
  const parsed = parseShardBasename(input.socket)
  if (parsed === null) return
  const metaPath = shardMetaPath(dirname(input.socket), parsed.kind, parsed.key)
  const fs = input.fs ?? DURABLE_JSON_FS
  await withTaskRecordLockAsync(metaPath, async () => {
    const previous = readSidecarObject(fs, metaPath)
    const ownerSessionId = input.owner?.ownerSessionId ?? stringField(previous, "owner_session_id")
    const ownerSessionFile = input.owner?.ownerSessionFile ?? stringField(previous, "owner_session_file")
    const sidecar: ShardSidecar = {
      socket: input.socket,
      kind: parsed.kind,
      root: dirname(input.socket),
      ...(ownerSessionId === undefined ? {} : { owner_session_id: ownerSessionId }),
      ...(ownerSessionFile === undefined ? {} : { owner_session_file: ownerSessionFile }),
      created_at: new Date(input.now()).toISOString(),
      created_by_pid: input.pid,
      ...(input.notice === undefined ? {} : { notice: input.notice }),
      stores: storesOf(previous),
    }
    fs.write(metaPath, `${JSON.stringify(sidecar, null, 2)}\n`)
  }, DURABLE_JSON_LOCK_OPTIONS)
}

export interface RegisterSidecarStoreInput {
  readonly socket: string
  readonly storeDir: string
  readonly fs?: DurableJsonFs
}

export type SidecarStoreResult = "registered" | "already_registered" | "no_sidecar"

export async function registerSidecarStore(input: RegisterSidecarStoreInput): Promise<SidecarStoreResult> {
  const metaPath = shardSidecarPath(input.socket)
  if (metaPath === undefined) return "no_sidecar"
  const fs = input.fs ?? DURABLE_JSON_FS
  const storeDir = resolve(input.storeDir)
  return await withTaskRecordLockAsync(metaPath, async () => {
    const previous = readSidecarObject(fs, metaPath)
    if (previous === undefined) return "no_sidecar"
    const stores = storesOf(previous)
    if (stores.includes(storeDir) && Array.isArray(previous.stores)) return "already_registered"
    const next = { ...previous, stores: stores.includes(storeDir) ? stores : [...stores, storeDir] }
    fs.write(metaPath, `${JSON.stringify(next, null, 2)}\n`)
    return "registered"
  }, DURABLE_JSON_LOCK_OPTIONS)
}

export function readShardSidecar(metaPath: string, fs: DurableJsonFs = DURABLE_JSON_FS): Record<string, unknown> | undefined {
  return readSidecarObject(fs, metaPath)
}

function readSidecarObject(fs: DurableJsonFs, metaPath: string): Record<string, unknown> | undefined {
  const text = fs.read(metaPath)
  if (text === undefined) return undefined
  const parsed: unknown = JSON.parse(text)
  if (!isRecord(parsed)) throw new Error(`shard sidecar ${metaPath} is not an object`)
  return parsed
}

function storesOf(sidecar: Record<string, unknown> | undefined): string[] {
  const stores = sidecar?.stores
  return Array.isArray(stores) ? stores.filter((entry): entry is string => typeof entry === "string") : []
}

function stringField(sidecar: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = sidecar?.[key]
  return typeof value === "string" ? value : undefined
}
