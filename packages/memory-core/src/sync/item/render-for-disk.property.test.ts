import { describe, expect, test } from "bun:test"

import { itemFrontier, renderForDisk, renderItem, splitItem } from "./index"
import { captureCurrent, captureInto, newDoc } from "./test-support"

// Lead r6 property: a second device writes a file another device edited. Invariants, per case:
// (1) a BOM appears at most once, and only if the source had one; (2) every line the client writes
// uses the file's dominant line ending (majority of its line breaks, ties to the first break);
// (3) untouched bytes stay byte-exact (the body, the fences, the lines of untouched keys);
// (4) writing again is idempotent and a recapture is a no-op.

type Style = "lf" | "crlf" | "mixed"
type Front = "valid" | "none" | "malformed" | "unclosed"
type Op = "change" | "add" | "delete" | "untouched"

const SEEDS_PER_CELL = 12

function prng(seed: number): () => number {
  let state = seed * 2654435761 + 1
  return () => {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x6d2b79f5) >>> 0
    return state / 4294967296
  }
}

function breaks(style: Style, rand: () => number, count: number): string[] {
  if (style !== "mixed") return Array.from({ length: count }, () => (style === "crlf" ? "\r\n" : "\n"))
  const out = Array.from({ length: count }, () => (rand() < 0.5 ? "\r\n" : "\n"))
  if (!out.includes("\r\n")) out[Math.floor(rand() * count)] = "\r\n"
  if (!out.includes("\n")) out[Math.floor(rand() * count)] = "\n"
  return out
}

function dominant(text: string): string {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const lf = (text.match(/\n/g) ?? []).length - crlf
  if (crlf !== lf) return crlf > lf ? "\r\n" : "\n"
  const first = text.indexOf("\n")
  return first > 0 && text[first - 1] === "\r" ? "\r\n" : "\n"
}

function linesOf(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? []
}

interface Case {
  readonly disk: string
  readonly working: string
  readonly touchedKeys: ReadonlySet<string>
}

function build(bom: boolean, style: Style, front: Front, op: Op, rand: () => number): Case {
  const e = breaks(style, rand, 9)
  const keys = [["n", "2"], ["k", "x"], ["z", "1"]].sort(() => rand() - 0.5)
  const body = `body line${e[6]}second${e[7]}`
  const header = keys.map(([key, value], index) => `${key}: ${value}${e[index + 1]}`).join("")
  const content =
    front === "valid" ? `---${e[0]}${header}---${e[4]}${body}`
    : front === "none" ? body
    : front === "malformed" ? `---${e[0]}n: [${e[1]}k: x${e[2]}---${e[4]}${body}`
    : `---${e[0]}n: 2${e[1]}${body}`
  const touched = new Set<string>()
  let edited = content
  if (front === "valid" && op !== "untouched") {
    if (op === "change") { edited = content.replace("n: 2", "n: 3"); touched.add("n") }
    if (op === "add") { const last = `${keys[2]?.[0]}: ${keys[2]?.[1]}${e[3]}`; edited = content.replace(last, `${last}added: v${e[5]}`); touched.add("added") }
    if (op === "delete") { edited = content.replace(/k: x\r?\n/, ""); touched.add("k") }
  } else if (front === "none" && op === "add") {
    edited = `---${e[0]}added: v${e[1]}---${e[2]}${content}`
  } else if (op === "change") edited = content.replace("second", "second2")
  else if (op === "add") edited = `${content}third${e[8]}`
  else if (op === "delete") edited = content.replace(/body line\r?\n/, "")
  const mark = bom ? "\ufeff" : ""
  return { disk: `${mark}${content}`, working: `${mark}${edited}`, touchedKeys: touched }
}

function headerRegion(text: string): string {
  const body = splitItem(text).body
  const content = text.startsWith("\ufeff") ? text.slice(1) : text
  return content.slice(0, content.length - body.length)
}

function keyOf(line: string): string | null {
  const m = /^([a-z]+):/.exec(line)
  return m?.[1] ?? null
}

async function check(bom: boolean, style: Style, front: Front, op: Op, seed: number): Promise<string | null> {
  const c = build(bom, style, front, op, prng(seed))
  const a = await newDoc("1")
  const b = await newDoc("2")
  try {
    captureInto(a, "", [], c.disk)
    b.import(a.export({ mode: "update" }))
    captureInto(a, renderItem(a) ?? "", itemFrontier(a), c.working)
    b.import(a.export({ mode: "update" }))
    const written = renderForDisk(b, c.disk) ?? ""
    const fail = (why: string) => `${why}: disk=${JSON.stringify(c.disk)} working=${JSON.stringify(c.working)} written=${JSON.stringify(written)}`
    const boms = written.split("\ufeff").length - 1
    if (boms !== (bom ? 1 : 0) || (bom && !written.startsWith("\ufeff"))) return fail(`(1) ${boms} BOMs`)
    if (splitItem(written).body !== splitItem(c.working).body) return fail("(3) body bytes differ")
    if (op === "untouched" && written !== c.disk) return fail("(3) untouched file rewritten")
    const eol = dominant(c.disk.replace(/^\ufeff/, ""))
    const diskHeader = linesOf(headerRegion(c.disk))
    const writtenHeader = linesOf(headerRegion(written))
    for (const line of writtenHeader) {
      if (!diskHeader.includes(line) && !line.endsWith(eol)) return fail(`(2) written line ${JSON.stringify(line)} not in the dominant style`)
      if (line.endsWith("\r\n") === false && line.endsWith("\n") && eol === "\r\n" && !diskHeader.includes(line)) return fail("(2) mixed written line")
    }
    if (splitItem(c.disk).fm !== null && splitItem(written).fm !== null) {
      for (const line of diskHeader) {
        const key = keyOf(line)
        const untouched = key === null ? line.startsWith("---") : !c.touchedKeys.has(key)
        if (untouched && !writtenHeader.includes(line)) return fail(`(3) untouched line ${JSON.stringify(line)} lost`)
      }
    }
    if (renderForDisk(b, written) !== written) return fail("(4) second write differs")
    if (captureCurrent(b, written) !== null) return fail("(4) recapture is not a no-op")
    return null
  } finally {
    a.free()
    b.free()
  }
}

describe("renderForDisk second-device property (lead r6 override)", () => {
  test(`BOM x line ending x frontmatter shape x edit, ${SEEDS_PER_CELL} seeds per cell: invariants (1)-(4) hold`, async () => {
    const failures: string[] = []
    let cases = 0
    for (const bom of [false, true])
      for (const style of ["lf", "crlf", "mixed"] as const)
        for (const front of ["valid", "none", "malformed", "unclosed"] as const)
          for (const op of ["change", "add", "delete", "untouched"] as const)
            for (let seed = 0; seed < SEEDS_PER_CELL; seed++) {
              cases++
              const failure = await check(bom, style, front, op, seed)
              if (failure !== null) failures.push(`bom=${bom} ${style} ${front} ${op} seed=${seed}: ${failure}`)
            }
    expect(cases).toBe(2 * 3 * 4 * 4 * SEEDS_PER_CELL)
    expect(failures.slice(0, 12), `${failures.length} of ${cases} cases fail`).toEqual([])
  }, 120000)
})
