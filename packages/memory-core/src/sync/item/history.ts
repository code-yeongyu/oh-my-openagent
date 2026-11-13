// History walk over the oplog (sync-design §2): the kind of a frontmatter key and the
// on-disk order of keys and set elements are decided by the EARLIEST operation that
// wrote them, in (Lamport, peer) order. That order lives only in the oplog - an op
// cannot carry its own Lamport stamp - so it is derived here, identically on every
// peer that holds the same history. No timestamp or peer order ever decides content.

import type { LoroDoc, PeerID } from "../../crdt/loro-runtime"

export type FmPart = "set" | "reg"

export interface Stamp {
  readonly lamport: number
  readonly peer: PeerID
}

export interface KeyHistory {
  readonly kind: FmPart
  readonly first: Stamp
  readonly byKind: ReadonlyMap<FmPart, Stamp>
}

export interface ItemHistory {
  readonly keys: ReadonlyMap<string, KeyHistory>
  readonly setAdds: ReadonlyMap<string, ReadonlyMap<string, Stamp>>
  readonly regAdds: ReadonlyMap<string, ReadonlyMap<string, Stamp>>
}

interface OpLike {
  readonly rootName: string | null
  readonly counter: number
  readonly content: unknown
}

// Keyed by the oplog size, not changeCount(): Loro merges consecutive same-peer commits
// into one Change, so the change count can stay put while new ops land.
const cache = new WeakMap<LoroDoc, { readonly oplogSize: number; readonly value: ItemHistory }>()

function oplogSize(doc: LoroDoc): number {
  let size = 0
  for (const end of doc.oplogVersion().toJSON().values()) size += end
  return size
}

export function analyzeHistory(doc: LoroDoc): ItemHistory {
  const size = oplogSize(doc)
  const hit = cache.get(doc)
  if (hit !== undefined && hit.oplogSize === size) return hit.value

  const keys = new Map<string, { kind: FmPart; first: Stamp; byKind: Map<FmPart, Stamp> }>()
  const setAdds = new Map<string, Map<string, Stamp>>()
  const regAdds = new Map<string, Map<string, Stamp>>()
  const changes = [...doc.getAllChanges().values()].flat()
  changes.sort((a, b) => a.lamport - b.lamport || peerCompare(a.peer, b.peer))
  for (const change of changes) {
    for (const op of readOps(doc, { peer: change.peer, counter: change.counter })) {
      const parsed = op.rootName === null ? null : parseFmName(op.rootName)
      if (parsed === null) continue
      const stamp: Stamp = { lamport: change.lamport + (op.counter - change.counter), peer: change.peer }
      const existing = keys.get(parsed.key)
      if (existing === undefined) {
        keys.set(parsed.key, { kind: parsed.part, first: stamp, byKind: new Map([[parsed.part, stamp]]) })
      } else if (!existing.byKind.has(parsed.part)) {
        existing.byKind.set(parsed.part, stamp)
      }
      {
        const tag = mapInsertKey(op.content)
        if (tag !== null) {
          const book = parsed.part === "set" ? setAdds : regAdds
          const perKey = book.get(parsed.key) ?? new Map<string, Stamp>()
          if (!perKey.has(tag)) perKey.set(tag, stamp)
          book.set(parsed.key, perKey)
        }
      }
    }
  }

  const value: ItemHistory = { keys, setAdds, regAdds }
  cache.set(doc, { oplogSize: size, value })
  return value
}

function peerCompare(a: PeerID, b: PeerID): number {
  const pa = BigInt(a)
  const pb = BigInt(b)
  return pa < pb ? -1 : pa > pb ? 1 : 0
}

function readOps(doc: LoroDoc, id: { peer: PeerID; counter: number }): readonly OpLike[] {
  const ops: unknown = doc.getOpsInChange(id)
  if (!Array.isArray(ops)) return []
  const out: OpLike[] = []
  for (const raw of ops) {
    if (typeof raw !== "object" || raw === null) continue
    if (!("counter" in raw) || typeof raw.counter !== "number") continue
    out.push({
      rootName: "container" in raw ? rootContainerName(raw.container) : null,
      counter: raw.counter,
      content: "content" in raw ? raw.content : undefined,
    })
  }
  out.sort((a, b) => a.counter - b.counter)
  return out
}

// loro's JSON op shape: container is { Root: { name, container_type } } for root
// containers (string ids appear only in getChangedContainersIn), and a map write is
// content { Map: { key, value } }.
function rootContainerName(container: unknown): string | null {
  if (typeof container !== "object" || container === null) return null
  if (!("Root" in container)) return null
  const root = container.Root
  if (typeof root !== "object" || root === null) return null
  if (!("name" in root) || typeof root.name !== "string") return null
  return root.name
}

function mapInsertKey(content: unknown): string | null {
  if (typeof content !== "object" || content === null) return null
  if (!("Map" in content)) return null
  const map = content.Map
  if (typeof map !== "object" || map === null) return null
  if (!("key" in map) || typeof map.key !== "string") return null
  return map.key
}

const SEP = "\x1f"

function parseFmName(name: string): { readonly key: string; readonly part: FmPart } | null {
  const segments = name.split(SEP)
  const part = segments[2]
  if (segments.length !== 3 || segments[0] !== "fm") return null
  if (part !== "set" && part !== "reg") return null
  try {
    return { key: decodeURIComponent(segments[1] ?? ""), part }
  } catch {
    return null
  }
}
