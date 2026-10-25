import { describe, expect, test } from "bun:test"

import { itemFrontier, renderItem } from "./index"
import { captureItem } from "./capture"
import { mulberry32, newDoc, pick, shuffled } from "./test-support"

const KEY_POOL = ["description", "title", "count", "flag", "due", "tags", "meta", "note"] as const
const WORD_POOL = ["plain", "héllo", "한글", "🙂🙂", "two words", "with: colon", "42", "true", "2026-01-07"] as const
const PLAIN_SAFE = /^[A-Za-z0-9._-]+( [A-Za-z0-9._-]+)*$/

function multilineScalar(rand: () => number): string {
  const lines = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => pick(rand, WORD_POOL))
  const text = lines.join("\n")
  if (rand() < 0.5) return `|\n    ${lines.join("\n    ")}`
  return JSON.stringify(text)
}

function scalarSource(rand: () => number): string {
  const roll = rand()
  if (roll < 0.2) return String(Math.floor(rand() * 1000))
  if (roll < 0.3) return rand() < 0.5 ? "true" : "false"
  if (roll < 0.4) return `2026-01-0${1 + Math.floor(rand() * 9)}`
  const word = pick(rand, WORD_POOL)
  const reserved = /^(true|false|null|\d|2026-)/.test(word)
  return PLAIN_SAFE.test(word) && !reserved ? word : JSON.stringify(word)
}

function fmEntry(rand: () => number, key: string): string {
  const roll = rand()
  if (roll < 0.15) return `${key}:\n    a: ${Math.floor(rand() * 10)}`
  if (roll < 0.3) {
    const n = 1 + Math.floor(rand() * 3)
    const els = Array.from({ length: n }, () => `  - ${scalarSource(rand)}`)
    return `${key}:\n${els.join("\n")}`
  }
  if (roll < 0.45) return `${key}: ${multilineScalar(rand)}`
  return `${key}: ${scalarSource(rand)}`
}

function genItem(rand: () => number): string {
  const bodyLines = Array.from(
    { length: Math.floor(rand() * 5) },
    () => Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(rand, WORD_POOL)).join(" "),
  )
  const body = bodyLines.length === 0 ? "" : `${bodyLines.join("\n")}\n`

  const roll = rand()
  if (roll < 0.06) return `---\n: broken: [\n---\n${body}`
  if (roll < 0.1) return `---\n- not\n- a\n- map\n---\n${body}`
  if (roll < 0.16) return body === "" ? "note\n" : body

  const keys = shuffled(KEY_POOL, rand).slice(0, Math.floor(rand() * 5))
  if (keys.length === 0) return body === "" ? "note\n" : body
  const header = keys.map((k) => fmEntry(rand, k)).join("\n")
  return `---\n${header}\n---\n${body}`
}

describe("render/capture round trip on generated items (sync-design §10)", () => {
  test("render(capture(render(x))) yields zero ops on 500 items", async () => {
    const rand = mulberry32(42)
    for (let i = 0; i < 500; i++) {
      const text = genItem(rand)
      const peer = (["1", "2", "3"] as const)[i % 3] ?? "1"
      const doc = await newDoc(peer)
      try {
        const update = captureItem(doc, "", [], text)
        if (update !== null) doc.import(update)
        const rendered = renderItem(doc)
        expect(rendered).not.toBeNull()
        const again = captureItem(doc, rendered ?? "", itemFrontier(doc), rendered ?? "")
        expect(again, `item ${i} re-captured ops: ${JSON.stringify(text)}`).toBeNull()
        expect(renderItem(doc)).toBe(rendered)
      } finally {
        doc.free()
      }
    }
  }, 30_000)
})
