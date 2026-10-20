// A deterministic item store standing in for the #10203 device: each item is a set of lines,
// added under ids derived from (device, item, baseline, line) so capturing the same edit against
// the same baseline twice yields the same ops (the device API's receipt idempotence), and deleted
// by tombstoning the ids the baseline showed. Merge is set union, so it converges like a CRDT.

import { createHash } from "node:crypto"
import { join } from "node:path"

import { readJson, writeJson } from "./atomic"
import type { BatchPayload, ItemStore } from "./ports"

interface ItemOps {
  readonly adds: Record<string, string>
  readonly kills: readonly string[]
}

interface Persisted {
  readonly items: Record<string, { adds: Record<string, string>; killed: string[] }>
  readonly materialized: Record<string, string | null>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const linesOf = (text: string | null): string[] => (text === null ? [] : text.split("\n").filter((l) => l !== ""))
const hash = (...parts: string[]): string => createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 16)

export class FakeItemStore implements ItemStore {
  private items = new Map<string, { adds: Map<string, string>; killed: Set<string> }>()
  private materialized = new Map<string, string | null>()
  private readonly file: string

  constructor(
    stateDir: string,
    private readonly device: string,
  ) {
    this.file = join(stateDir, "fake-store.json")
  }

  async load(): Promise<void> {
    const saved = await readJson<Persisted>(this.file, { items: {}, materialized: {} })
    this.items = new Map(
      Object.entries(saved.items).map(([k, v]) => [k, { adds: new Map(Object.entries(v.adds)), killed: new Set(v.killed) }]),
    )
    this.materialized = new Map(Object.entries(saved.materialized))
  }

  peer(): string {
    return this.device
  }

  keys(): readonly string[] {
    return [...new Set([...this.items.keys(), ...this.materialized.keys()])].sort()
  }

  async capture(key: string, workingText: string | null): Promise<Uint8Array | null> {
    const baseline = this.materialized.get(key) ?? null
    if (workingText === baseline) return null
    const base = linesOf(baseline)
    const work = linesOf(workingText)
    const baseTag = hash(baseline ?? "\u0000none")
    const adds: Record<string, string> = {}
    for (const line of work) if (!base.includes(line)) adds[hash(this.device, key, baseTag, line)] = line
    const item = this.items.get(key)
    const kills: string[] = []
    for (const line of base) {
      if (work.includes(line) || item === undefined) continue
      for (const [id, l] of item.adds) if (l === line && !item.killed.has(id)) kills.push(id)
    }
    this.materialized.set(key, workingText)
    if (Object.keys(adds).length === 0 && kills.length === 0) return null
    return encoder.encode(JSON.stringify({ adds, kills } satisfies ItemOps))
  }

  async apply(key: string, ops: Uint8Array): Promise<void> {
    const parsed = JSON.parse(decoder.decode(ops)) as ItemOps
    const item = this.items.get(key) ?? { adds: new Map<string, string>(), killed: new Set<string>() }
    for (const [id, line] of Object.entries(parsed.adds)) item.adds.set(id, line)
    for (const id of parsed.kills) item.killed.add(id)
    this.items.set(key, item)
  }

  render(key: string, _diskText: string | null): string | null {
    const item = this.items.get(key)
    if (item === undefined) return null
    const live = [...new Set([...item.adds].filter(([id]) => !item.killed.has(id)).map(([, line]) => line))].sort()
    return live.length === 0 ? null : `${live.join("\n")}\n`
  }

  async version(key: string): Promise<string> {
    const item = this.items.get(key)
    if (item === undefined) return ""
    return hash(`${[...item.adds.keys()].sort().join(",")}|${[...item.killed].sort().join(",")}`)
  }

  async markMaterialized(key: string, text: string | null): Promise<void> {
    this.materialized.set(key, text)
  }

  async applySnapshot(payload: BatchPayload): Promise<void> {
    for (const item of payload.items) await this.apply(item.key, item.ops)
  }

  async persist(): Promise<void> {
    const items: Persisted["items"] = {}
    for (const [k, v] of this.items) items[k] = { adds: Object.fromEntries(v.adds), killed: [...v.killed] }
    await writeJson(this.file, { items, materialized: Object.fromEntries(this.materialized) } satisfies Persisted)
  }

  /** The whole replicated state as one payload, the way a compacting device builds a snapshot. */
  snapshotPayload(): BatchPayload {
    return {
      items: [...this.items].map(([key, v]) => ({
        key,
        ops: encoder.encode(JSON.stringify({ adds: Object.fromEntries(v.adds), kills: [...v.killed] } satisfies ItemOps)),
      })),
    }
  }
}
