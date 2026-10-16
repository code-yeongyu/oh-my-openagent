import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"

import { parse as parseYaml, stringify as stringifyYaml } from "yaml"

import { renderScalar } from "./frontmatter"
import type { ItemDevice, ItemFrontier } from "./index"
import { captureOnDevice, createDeviceItemDoc, itemFrontier, recordMaterialized, renderItem } from "./index"
import { mulberry32, newDoc, withDevices } from "./test-support"

// Reviews r3-r5 property (oMo PR #10203), over a model of the sync engine with 3 devices.
// Each device has a doc, a file on disk and the baseline it last saved. The user edits typed
// fields concurrently on every device: a register (`n`), a text field (`description`), a set
// (`tags`) and the body. The engine captures disk against the saved baseline, double-fires,
// syncs, and materialises (receipt, write, save baseline), with crashes before the write or
// between the write and the baseline save, so drifted replays and synced writes without a
// baseline happen all the time. For every seed: all devices converge, all 6 delivery orders
// of the devices' updates into a fresh doc render the same bytes, every typed marker appears exactly once,
// every register component is a value some device wrote (never a spliced string), a settled
// re-capture is a no-op, and the version vector holds only device peers.

const SEEDS = 2000
const SHARD = 50
const ITEM = "item.md"

interface Node {
  readonly device: ItemDevice
  readonly doc: LoroDoc
  disk: string
  saved: { text: string; frontier: ItemFrontier }
}

interface Ledger {
  readonly markers: string[]
  readonly removed: Set<string>
  readonly written: Map<string, Set<string>>
}

function header(disk: string): Record<string, unknown> {
  if (!disk.startsWith("---\n")) return {}
  const end = disk.indexOf("\n---", 4)
  if (end < 0) return {}
  try {
    const parsed: unknown = parseYaml(disk.slice(4, end))
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? Object.fromEntries(Object.entries(parsed)) : {}
  } catch {
    return {}
  }
}

function bodyOf(disk: string): string {
  if (!disk.startsWith("---\n")) return disk
  const end = disk.indexOf("\n---\n", 3)
  return end < 0 ? disk : disk.slice(end + 5)
}

// A written value is recorded raw and as its canonical YAML source: a register with several
// values renders each component as its canonical source (spec #454).
// Hostile string content (memory-sync r6, review r6 L3): newlines, CR, tabs, leading/trailing
// spaces, '#', ': ', values over 80 columns, and whole values that are exactly a YAML indicator.
const HOSTILE_PARTS = ["", " ", "\n", "\r\n", "\t", " # ", ": ", " |- ", " > ", "\n---\n", ` ${"long ".repeat(20)}`, ` ${"긴 ".repeat(45)}`]
const EXACT = ["|-", ">", "#", ": x", " lead", "trail "]

function markersIn(text: string): string[] {
  return text.match(/m\d+x\d+q/g) ?? []
}

function hostile(rand: () => number): string {
  return HOSTILE_PARTS[Math.floor(rand() * HOSTILE_PARTS.length)] ?? ""
}

function record(ledger: Ledger, key: string, value: unknown): void {
  const set = ledger.written.get(key) ?? new Set<string>()
  set.add(String(value))
  set.add(Array.isArray(value) ? stringifyYaml(value, { collectionStyle: "flow", lineWidth: 0 }).trim() : renderScalar(String(value)))
  if (typeof value === "number") set.add(renderScalar(value))
  ledger.written.set(key, set)
}

// One user edit of the file on disk. Registers (n, description) get whole new values, string
// or number, including over a value currently shown as a conflict; tags get element adds,
// removals, and replacement of the whole list by one string (a kind change); the body gets
// appended lines. Every value a user ever wrote is recorded per key.
function edit(rand: () => number, disk: string, ledger: Ledger, seed: number): string {
  const fields = header(disk)
  let body = bodyOf(disk)
  const id = ledger.markers.length + [...ledger.written.values()].reduce((n, s) => n + s.size, 0)
  const token = `m${seed}x${id}q`
  const roll = rand()
  if (roll < 0.2) {
    const roll2 = rand()
    const value = roll2 < 0.4 ? seed * 1000 + id + 1 : roll2 < 0.55 ? (EXACT[Math.floor(rand() * EXACT.length)] ?? "|-") : `w${hostile(rand)}${token}`
    record(ledger, "n", value)
    fields.n = value
  } else if (roll < 0.4) {
    const value = `d${hostile(rand)}${token}`
    record(ledger, "description", value)
    fields.description = value
  } else if (roll < 0.65) {
    const old = Array.isArray(fields.tags) ? fields.tags.map(String) : []
    const op = rand()
    if (op < 0.6 || old.length === 0) {
      ledger.markers.push(token)
      const element = `${hostile(rand).trimStart()}${token}`
      record(ledger, "tags", element)
      fields.tags = [...old, element]
      // A list written whole into a register-kind key is stored as one value: its flow source.
      record(ledger, "tags", [...old, element])
    } else if (op < 0.85) {
      const drop = old[Math.floor(rand() * old.length)] ?? ""
      for (const marker of markersIn(drop)) ledger.removed.add(marker)
      fields.tags = old.filter((e) => e !== drop)
      if (old.length === 1) delete fields.tags
    } else {
      for (const e of old) for (const marker of markersIn(e)) ledger.removed.add(marker)
      const value = `k: ${token}`
      record(ledger, "tags", value)
      fields.tags = value
    }
  } else {
    ledger.markers.push(token)
    body = body === "" || body.endsWith("\n") ? `${body}${token}\n` : `${body}\n${token}\n`
  }
  const lines = Object.entries(fields).map(([key, value]) => stringifyYaml({ [key]: value }, { blockQuote: false, lineWidth: 0 }).trimEnd())
  return lines.length === 0 ? body : `---\n${lines.join("\n")}\n---\n${body}`
}

async function capture(node: Node): Promise<void> {
  const update = await captureOnDevice(node.device, ITEM, node.doc, node.saved.text, node.saved.frontier, node.disk)
  if (update !== null) node.doc.import(update)
}

async function materialise(node: Node, crash: "none" | "before-write" | "after-write"): Promise<void> {
  await capture(node)
  if (crash === "before-write") return
  const written = renderItem(node.doc) ?? ""
  await recordMaterialized(node.device, ITEM, node.doc, node.saved.frontier, written)
  node.disk = written
  if (crash === "after-write") return
  node.saved = { text: written, frontier: itemFrontier(node.doc) }
}

function sync(a: Node, b: Node): void {
  const ua = a.doc.export({ mode: "update" })
  const ub = b.doc.export({ mode: "update" })
  a.doc.import(ub)
  b.doc.import(ua)
}


async function runSeed(seed: number, devices: readonly ItemDevice[]): Promise<void> {
  const rand = mulberry32(seed)
  const nodes: Node[] = []
  for (const device of devices) {
    nodes.push({ device, doc: await createDeviceItemDoc(device), disk: "", saved: { text: "", frontier: [] } })
  }
  const pick = (): Node => nodes[Math.floor(rand() * nodes.length)] ?? nodes[0] ?? fail()
  const ledger: Ledger = { markers: [], removed: new Set(), written: new Map() }
  try {
    const steps = 10 + Math.floor(rand() * 12)
    for (let step = 0; step < steps; step++) {
      const node = pick()
      const roll = rand()
      if (roll < 0.4) node.disk = edit(rand, node.disk, ledger, seed)
      else if (roll < 0.52) await capture(node)
      else if (roll < 0.6) {
        await capture(node)
        await capture(node)
      } else if (roll < 0.82) {
        const crash = rand()
        await materialise(node, crash < 0.25 ? "before-write" : crash < 0.5 ? "after-write" : "none")
      } else sync(node, pick())
    }
    for (let round = 0; round < 2; round++) {
      for (const node of nodes) await materialise(node, "none")
      for (const a of nodes) for (const b of nodes) if (a !== b) sync(a, b)
    }
    for (const node of nodes) await materialise(node, "none")
    const rendered = renderItem(nodes[0]?.doc ?? fail()) ?? ""
    for (const node of nodes) expect(renderItem(node.doc) ?? "", `seed ${seed}: devices diverged`).toBe(rendered)
    const exports = nodes.map((node) => node.doc.export({ mode: "update" }))
    for (const order of permutations(exports.length)) {
      const fresh = await newDoc("9")
      for (const index of order) fresh.import(exports[index] ?? fail())
      expect(renderItem(fresh) ?? "", `seed ${seed}: delivery order ${order.join("")} diverged`).toBe(rendered)
      fresh.free()
    }
    const settled = header(rendered)
    for (const key of ["n", "description"]) {
      if (settled[key] === undefined) continue
      for (const part of String(settled[key]).split(" / ")) {
        expect(ledger.written.get(key)?.has(part), `seed ${seed}: ${key} holds ${JSON.stringify(part)}, never written`).toBe(true)
      }
    }
    const tags = settled.tags
    for (const element of Array.isArray(tags) ? tags : tags === undefined ? [] : String(tags).split(" / ")) {
      expect(typeof element, `seed ${seed}: tags element ${JSON.stringify(element)} is not a string`).toBe("string")
      expect(ledger.written.get("tags")?.has(String(element)), `seed ${seed}: tags holds ${JSON.stringify(element)}, never written`).toBe(true)
    }
    for (const marker of ledger.markers) {
      const count = rendered.split(marker).length - 1
      const expected = ledger.removed.has(marker) ? 0 : 1
      expect(count, `seed ${seed}: marker ${marker} appears ${count} times, expected ${expected}`).toBe(expected)
    }
    for (const node of nodes) {
      const again = await captureOnDevice(node.device, ITEM, node.doc, node.saved.text, node.saved.frontier, node.disk)
      expect(again, `seed ${seed}: settled re-capture minted ops`).toBeNull()
    }
    const devicePeers = new Set<string>(devices.map((d) => d.peer))
    const foreign = [...(nodes[0]?.doc ?? fail()).oplogVersion().toJSON().keys()].filter((peer) => !devicePeers.has(peer))
    expect(foreign, `seed ${seed}: version vector holds non-device peers`).toEqual([])
  } finally {
    for (const node of nodes) node.doc.free()
  }
}

function permutations(n: number): number[][] {
  if (n === 0) return [[]]
  return permutations(n - 1).flatMap((rest) => Array.from({ length: n }, (_, at) => [...rest.slice(0, at), n - 1, ...rest.slice(at)]))
}

function fail(): never {
  throw new Error("three devices expected")
}

describe("reviews r3-r5: typed-field capture property over a 3-device engine model", () => {
  for (let start = 0; start < SEEDS; start += SHARD) {
    test(`seeds ${start}..${start + SHARD - 1}: concurrent register/text/set/body edits converge, once, unspliced`, async () => {
      for (let seed = start; seed < start + SHARD; seed++) {
        try {
          await withDevices(3, (devices) => runSeed(seed, devices))
        } catch (error) {
          console.error(`r5 property failing seed: ${seed}`)
          throw error
        }
      }
    }, 120_000)
  }
})
