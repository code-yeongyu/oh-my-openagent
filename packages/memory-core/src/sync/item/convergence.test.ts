import { describe, expect, test } from "bun:test"

import { renderItem } from "./index"
import { captureCurrent, mulberry32, newDoc, pick, shuffled } from "./test-support"

const BODY_POOL = "abcdefgh \n".split("")
const KEYS = ["alpha", "beta", "gamma"] as const

function bodySplice(rand: () => number, text: string): string {
  const headerEnd = text.startsWith("---\n") ? text.indexOf("\n---\n", 4) : -1
  const bodyStart = headerEnd >= 0 ? headerEnd + 5 : 0
  const cps = Array.from(text.slice(bodyStart))
  const at = Math.floor(rand() * (cps.length + 1))
  const del = Math.min(cps.length - at, Math.floor(rand() * 9))
  const ins = Array.from({ length: Math.floor(rand() * 13) }, () => pick(rand, BODY_POOL)).join("")
  return text.slice(0, bodyStart) + cps.slice(0, at).join("") + ins + cps.slice(at + del).join("")
}

function fmValueBlock(rand: () => number, key: string): string {
  const roll = rand()
  if (roll < 0.3) return `${key}: ${Math.floor(rand() * 100)}`
  if (roll < 0.5) return `${key}: ${rand() < 0.5 ? "true" : "false"}`
  if (roll < 0.7) return `${key}: word${Math.floor(rand() * 100)}`
  const a = Math.floor(rand() * 10)
  const b = Math.floor(rand() * 10)
  return `${key}:\n  - e${a}\n  - e${b}`
}

function fmWrite(rand: () => number, text: string, key: string): string {
  const block = fmValueBlock(rand, key)
  if (!text.startsWith("---\n")) return `---\n${block}\n---\n${text}`
  const headerEnd = text.indexOf("\n---\n", 4)
  if (headerEnd < 0) return text
  const lines = text.slice(4, headerEnd).split("\n")
  const start = lines.findIndex((l) => l.startsWith(`${key}:`))
  if (start < 0) return `${text.slice(0, headerEnd)}\n${block}${text.slice(headerEnd)}`
  let end = start + 1
  while (end < lines.length && (lines[end] ?? "").startsWith("  - ")) end++
  lines.splice(start, end - start, ...block.split("\n"))
  return `${text.slice(0, 4)}${lines.join("\n")}${text.slice(headerEnd)}`
}

function fmRemove(text: string, key: string): string {
  if (!text.startsWith("---\n")) return text
  const headerEnd = text.indexOf("\n---\n", 4)
  if (headerEnd < 0) return text
  const lines = text.slice(4, headerEnd).split("\n")
  const start = lines.findIndex((l) => l.startsWith(`${key}:`))
  if (start < 0) return text
  let end = start + 1
  while (end < lines.length && (lines[end] ?? "").startsWith("  - ")) end++
  lines.splice(start, end - start)
  if (lines.every((l) => l.trim() === "")) return text.slice(headerEnd + 5)
  return `${text.slice(0, 4)}${lines.join("\n")}${text.slice(headerEnd)}`
}

async function scriptedUpdates(peer: `${number}`, seed: number): Promise<Uint8Array[]> {
  const rand = mulberry32(seed)
  const doc = await newDoc(peer)
  const updates: Uint8Array[] = []
  for (let i = 0; i < 10; i++) {
    const current = renderItem(doc) ?? ""
    const roll = rand()
    const next = roll < 0.45
      ? bodySplice(rand, current)
      : roll < 0.7
        ? fmWrite(rand, current, pick(rand, KEYS))
        : roll < 0.85
          ? fmRemove(current, pick(rand, KEYS))
          : current
    if (next === current) continue
    const update = captureCurrent(doc, next)
    if (update !== null) updates.push(update)
  }
  doc.free()
  return updates
}

describe("whole-item convergence property (sync-design §10)", () => {
  test("1,000 random import orders converge to identical bytes", async () => {
    const updates: Uint8Array[] = []
    for (const [i, peer] of (["1", "2", "3"] as const).entries()) {
      updates.push(...(await scriptedUpdates(peer, 1000 + i)))
    }
    expect(updates.length).toBeGreaterThan(0)

    const reference = await newDoc("9")
    for (const update of updates) reference.import(update)
    const expected = renderItem(reference)
    reference.free()

    const distinct = new Set<string | null>()
    const rand = mulberry32(7)
    for (let order = 0; order < 1000; order++) {
      const doc = await newDoc("9")
      for (const update of shuffled(updates, rand)) doc.import(update)
      distinct.add(renderItem(doc))
      doc.free()
    }
    expect(distinct.size).toBe(1)
    expect([...distinct][0]).toBe(expected)
  }, 30_000)
})
