import { expect, test } from "bun:test"

import { splitItem, type FmEntry } from "../item/frontmatter"
import { activeRegisters } from "../item/index"
import { renderDocContent } from "../item/render"
import { captureInto, mulberry32, newDoc, pick } from "../item/test-support"
import { planAdoption } from "./adopt"
import { confirmRemovals, type RemovalDecision } from "./confirm-removals"
import { stripT2Blocks } from "./hub-trace"
import { applyPlan, holdsValue, plainValue, renderedFacts, soleRegisters, t2Block } from "./test-support"

// Each seed's 2,000 cases run as CHUNKS_PER_SEED tests of 250. One 2,000-case test used 47 s of a
// 60 s cap on a Windows runner and timed out on a slower one (#10413); a chunk is an eighth of
// that work under the same cap (6.5 s at most on windows-latest).
const PROPERTY_TIMEOUT_MS = 60_000
const CASES_PER_SEED = 2000
const CHUNKS_PER_SEED = 8

// The deletion gate (HIGH-1, structural guarantee): a source file may be queued in
// removalCandidates only when a read-back of the merged result proves every one of its
// facts survived — every body line intact, every frontmatter value held as a whole register
// component or set element. Otherwise the source stays on disk with a reason.

function linesOf(text: string): readonly string[] {
  if (text === "") return []
  const lines = text.split("\n")
  if (text.endsWith("\n")) lines.pop()
  return lines
}

/** The facts a source file carries, read through stripT2Blocks: not independent of the code under test (R1 in adopt-readback.test.ts is). */
function factsOf(source: string): { readonly bodyLines: readonly string[]; readonly entries: readonly FmEntry[] } {
  const parsed = splitItem(source.replace(/\r\n/g, "\n"))
  const stripped = stripT2Blocks(parsed.body)
  return {
    bodyLines: linesOf(stripped.body),
    entries: [...(parsed.fm ?? []), ...stripped.entries].filter((entry) => entry.value.kind !== "remove"),
  }
}

const LINE_POOL = [
  "- likes tea",
  "- likes coffee",
  "- hates tea",
  "I like tea.",
  "I do not like tea anymore.",
  "ax",
  "abc",
  "xyz",
  "note 3: alpha beta",
  "prefers 한글 메모",
  "emoji line 🙂🚀",
  "",
] as const

function genDoc(rand: () => number, tag: string): string {
  const eol = pick(rand, ["\n", "\n", "\n", "\r\n"])
  const fields: string[] = []
  if (rand() < 0.7) {
    const count = 1 + Math.floor(rand() * 3)
    for (let i = 0; i < count; i++) {
      fields.push(pick(rand, [
        `title: "t-${tag}-${i}"`,
        `tags: [shared, "${tag}-${i}"]`,
        `count: ${Math.floor(rand() * 50)}`,
        `due: 2026-01-0${1 + Math.floor(rand() * 9)}`,
      ]))
    }
  }
  const body = Array.from({ length: Math.floor(rand() * 4) }, () => pick(rand, LINE_POOL))
  const head = fields.length > 0 ? `---${eol}${fields.join(eol)}${eol}---${eol}` : ""
  let text = head + body.join(eol)
  if (text !== "" && rand() < 0.7) text += eol
  return text
}

function genFmOnly(rand: () => number, tag: string): string {
  const text = genDoc(rand, tag)
  const parsed = splitItem(text)
  if (parsed.fm === null || parsed.fm.length === 0) return `---\nnote: "${tag}"\n---\n`
  return `---\n${text.slice(3, text.indexOf("---", 4))}---\n`
}

type A3Case = {
  readonly iteration: number
  readonly space: string
  readonly sides: readonly { readonly path: string; readonly text: string }[]
  readonly remembered: boolean
  readonly files: readonly { readonly path: string; readonly text: string }[]
}

/** The seed's whole case stream, drawn in one pass so chunking never changes which cases run. */
function a3Cases(seed: number): readonly A3Case[] {
  const rand = mulberry32(seed)
  return Array.from({ length: CASES_PER_SEED }, (_, iteration) => {
    const space = genDoc(rand, `s${iteration}`)
    let main = genDoc(rand, `m${iteration}`)
    if (rand() < 0.4) main += t2Block("2026-10-15", "n.md", genFmOnly(rand, `t${iteration}`))
    const sides = Array.from({ length: 1 + Math.floor(rand() * 2) }, (_, i) => ({
      path: `n.sync-conflict-20261015-${i === 0 ? "mac" : "mini"}.md`,
      text: genDoc(rand, `x${iteration}-${i}`),
    }))
    const remembered = rand() < 0.3
    return { iteration, space, sides, remembered, files: [{ path: "n.md", text: main }, ...sides] }
  })
}

for (const seed of [20261016, 0xde1e7106]) {
  const cases = a3Cases(seed)
  const chunkSize = CASES_PER_SEED / CHUNKS_PER_SEED
  for (let chunk = 0; chunk < CHUNKS_PER_SEED; chunk++) {
    const first = chunk * chunkSize
    const last = first + chunkSize - 1
    test(`A3 a deleted source's facts survive in the COMMITTED item, or it is kept; seed=${seed}, cases=${first}..${last}`, async () => {
      // Given random mains, T2 blocks and side files with overlapping prose and keys.
      for (const { iteration, space, sides, remembered, files } of cases.slice(first, last + 1)) {
        // When the plan is committed into a real item and deletion is decided on the committed item.
        const doc = await newDoc("1")
        let output = ""
        let decision: RemovalDecision = { remove: [], retained: [] }
        try {
          captureInto(doc, "", [], space)
          const base = renderDocContent(doc)
          const plan = planAdoption(files, {
            currentText: base === "" ? null : base,
            lastMaterialised: remembered && base !== "" ? base : null,
            tombstoned: false,
            registers: activeRegisters(doc),
          })
          applyPlan(doc, base, plan)
          output = renderDocContent(doc)
          decision = confirmRemovals(doc, plan, files)
        } finally {
          doc.free()
        }
        const context = `A3 seed=${seed} case=${iteration}`
        const outFacts = renderedFacts(output)
        const outBodyLines = linesOf(splitItem(output).body)
        const retained = new Map(decision.retained.map((entry) => [entry.path, entry.reason]))
        for (const side of sides) {
          const queued = decision.remove.includes(side.path)
          if (queued) {
            // Then every fact of the deleted source is intact in the output.
            const { bodyLines, entries } = factsOf(side.text)
            for (const line of bodyLines) {
              expect(outBodyLines.includes(line), `${context} deleted ${side.path} lost body line ${JSON.stringify(line)} output=${JSON.stringify(output)}`).toBe(true)
            }
            for (const entry of entries) {
              expect(
                holdsValue(outFacts, entry.key, plainValue(entry.value)),
                `${context} deleted ${side.path} lost ${JSON.stringify(entry)} output=${JSON.stringify(output)}`,
              ).toBe(true)
            }
          } else {
            // Or the source stays on disk with a structured reason.
            expect(typeof retained.get(side.path), `${context} ${side.path} kept without a reason`).toBe("string")
          }
          expect(queued !== retained.has(side.path), `${context} ${side.path} both queued and retained`).toBe(true)
        }
      }
    }, PROPERTY_TIMEOUT_MS)
  }
}

test("a merge that drops a line keeps the source and records the reason", () => {
  // Given a merge that silently drops the incoming file's lines (forced read-back failure).
  const dropIncoming = (base: string, incoming: string): string => (base === "" ? incoming : base)
  const plan = planAdoption(
    [{ path: "n.sync-conflict-20261015-mac.md", text: "- likes tea\n" }],
    { currentText: "- likes coffee\n", lastMaterialised: null, tombstoned: false, registers: soleRegisters("- likes coffee\n") },
    dropIncoming,
  )
  // Then the side file is not deleted and the reason names the missing line.
  expect(plan.removalCandidates).toEqual([])
  expect(plan.retainedSources ?? []).toEqual([
    { path: "n.sync-conflict-20261015-mac.md", reason: 'missing line "- likes tea"' },
  ])
})

test("a side file whose facts all survive is queued for deletion", () => {
  const plan = planAdoption(
    [
      { path: "n.md", text: "- likes tea\n- likes coffee\n" },
      { path: "n.sync-conflict-20261015-mac.md", text: "- likes tea\n" },
    ],
    { currentText: "- likes tea\n- likes coffee\n", lastMaterialised: null, tombstoned: false, registers: soleRegisters("- likes tea\n- likes coffee\n") },
  )
  expect(plan.removalCandidates).toEqual(["n.sync-conflict-20261015-mac.md"])
  expect(plan.retainedSources ?? []).toEqual([])
})
