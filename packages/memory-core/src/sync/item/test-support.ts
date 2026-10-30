// Shared helpers for the item-model tests: deterministic doc factory, capture/import
// plumbing, and a seeded PRNG for the property tests. Not a test file itself.

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { loadLoroRuntime, type LoroDoc } from "../../crdt/loro-runtime"
import type { ItemFrontier } from "./index"
import { itemFrontier, renderItem } from "./index"
import { captureItem } from "./capture"
import type { ItemDevice } from "./device"
import { openItemDevice } from "./device"

export type Peer = `${number}`

export async function newDoc(peer: Peer): Promise<LoroDoc> {
  const { LoroDoc } = await loadLoroRuntime()
  const doc = new LoroDoc()
  doc.setPeerId(peer)
  doc.setRecordTimestamp(false)
  return doc
}

/** Capture one working-tree state and import the resulting ops back, engine-style. */
export function captureInto(
  doc: LoroDoc,
  baseText: string,
  baseFrontier: ItemFrontier,
  workingText: string,
): Uint8Array | null {
  const update = captureItem(doc, baseText, baseFrontier, workingText)
  if (update !== null) doc.import(update)
  return update
}

/** Capture the transition from the doc's current materialised state to `workingText`. */
export function captureCurrent(doc: LoroDoc, workingText: string): Uint8Array | null {
  return captureInto(doc, renderItem(doc) ?? "", itemFrontier(doc), workingText)
}

/** Opens `count` devices, each with its own memory root and state dir, and removes them afterwards. */
export async function withDevices<T>(count: number, run: (devices: ItemDevice[]) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), "item-devices-"))
  try {
    const devices: ItemDevice[] = []
    for (let i = 0; i < count; i++) {
      devices.push(await openItemDevice({ stateDir: join(root, `d${i}`, "state"), memoryRoot: join(root, `d${i}`, "memory") }))
    }
    return await run(devices)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/** Deterministic PRNG (mulberry32) so property tests reproduce byte-for-byte. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function pick<T>(rand: () => number, items: readonly T[]): T {
  const choice = items[Math.floor(rand() * items.length)]
  if (choice === undefined) throw new Error("pick: empty pool")
  return choice
}

export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const a = out[i]
    const b = out[j]
    if (a === undefined || b === undefined) throw new Error("shuffle: hole")
    out[i] = b
    out[j] = a
  }
  return out
}
