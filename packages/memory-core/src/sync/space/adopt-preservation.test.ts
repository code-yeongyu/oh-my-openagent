import { expect, test } from "bun:test"

import { splitItem } from "../item/frontmatter"
import { activeRegisters } from "../item/index"
import { renderDocContent } from "../item/render"
import { captureInto, mulberry32, newDoc, pick } from "../item/test-support"
import { planAdoption } from "./adopt"

import { applyPlan, holdsValue, plainValue, renderedFacts, t2Block, soleRegisters } from "./test-support"

// 2,000 generated cases are CPU-bound; under host load they exceed bun's 5 s default.
const PROPERTY_TIMEOUT_MS = 60_000

function assertPreserved(sources: readonly string[], output: string, context: string): void {
  const actual = renderedFacts(output)
  expect(output.includes("memory-sync frontmatter conflict"), `${context} marker written`).toBe(false)
  for (const source of sources) {
    for (const entry of splitItem(source).fm ?? []) {
      if (entry.value.kind === "remove") continue
      expect(
        holdsValue(actual, entry.key, plainValue(entry.value)),
        `${context} missing ${JSON.stringify(entry)} output=${JSON.stringify(output)}`,
      ).toBe(true)
    }
  }
}

for (const seed of [20261016, 0x5a17c0de]) {
  test(`A1 adoption preserves all source keys and values; seed=${seed}, cases=2000`, async () => {
    // Given random overlapping keys, kinds and values in all four real sources,
    // including duplicate keys, non-ASCII, CRLF, unterminated and empty files.
    const rand = mulberry32(seed)
    const make = (source: number, iteration: number) => {
      if (rand() < 0.03) return ""
      const fields: string[] = []
      for (let key = 0; key < 4; key++) {
        if (rand() < 0.2) continue
        const token = `value-${iteration}-${source}-${key}`
        fields.push(pick(rand, [
          `k${key}: "${token}"`,
          `k${key}: [shared, "${token}"]`,
          `k${key}: ${source + iteration * 4}`,
          `k${key}: []`,
          `k${key}: "shared\\n${token} --> end"`,
          `k${key}: "한글-${token} 🙂"`,
          `키${key}: "${token}"`,
        ]))
      }
      if (rand() < 0.06 && fields.length > 0) fields.push(fields[0] ?? "")
      const eol = rand() < 0.2 ? "\r\n" : "\n"
      const header = fields.length ? fields.join(eol) : "empty: shared"
      const closing = rand() < 0.1 ? "---" : `---${eol}`
      return `---${eol}${header}${eol}${closing}`
    }
    for (let iteration = 0; iteration < 2000; iteration++) {
      const sources = Array.from({ length: 4 }, (_, source) => make(source, iteration))
      const [space = "", main = "", t2 = "", side = ""] = sources
      const sidePath = "n.sync-conflict-20261015-device.md"
      // When the plan folds a T2 block and a T1 side file into an existing space.
      const files = [
        { path: "n.md", text: main + t2Block("2026-10-15", "n.md", t2) },
        { path: sidePath, text: side },
      ]
      const plan = planAdoption(files, { currentText: space, lastMaterialised: null, tombstoned: false, registers: soleRegisters(space) })
      const output = plan.rendered
      // Then every value survives, including those whose only source is deleted.
      const context = `A1 seed=${seed} case=${iteration}`
      assertPreserved(sources, output, context)
      if (plan.removalCandidates.includes(sidePath)) assertPreserved([side], output, context)
      expect(plan.action, context).not.toBe("remove")
      const repeated = planAdoption(files, { currentText: output, lastMaterialised: null, tombstoned: false, registers: plan.registers })
      expect(repeated.action, `${context} repeated adoption`).toBe("none")
      if (iteration % 25 === 0) await expectCommitted(files, space, context)
    }
  }, PROPERTY_TIMEOUT_MS)
}

/** Commit the plan into a real item doc built from the space text: the doc renders exactly plan.rendered and holds plan.registers. */
async function expectCommitted(files: readonly { path: string; text: string }[], space: string, context: string): Promise<void> {
  const doc = await newDoc("1")
  try {
    captureInto(doc, "", [], space)
    const base = renderDocContent(doc)
    const plan = planAdoption(files, { currentText: base, lastMaterialised: null, tombstoned: false, registers: activeRegisters(doc) })
    applyPlan(doc, base, plan)
    expect(renderDocContent(doc), `${context} committed render`).toBe(plan.rendered)
    const sorted = (registers: ReadonlyMap<string, readonly string[]>) => new Map([...registers].map(([key, values]) => [key, [...values].sort()]))
    expect(sorted(activeRegisters(doc)), `${context} committed registers`).toEqual(sorted(plan.registers))
  } finally {
    doc.free()
  }
}

test("existing-key T2 and T1 values survive capture into the real item model", async () => {
  // Given the hub's actual differing-existing-key shape, not an absent-key fixture.
  const main = "---\ntitle: Main\ntags: [a]\nreviewed: true\n---\nmain\n"
  const other = "---\ntitle: Other\ntags: [a, b]\nreviewed: false\n---\n"
  const side = "---\ntitle: Side\ntags: [c]\nreviewed: 3\n---\nside\n"
  const plan = planAdoption([
    { path: "n.md", text: main + t2Block("2026-10-15", "n.md", other) },
    { path: "n.sync-conflict-20261015-device.md", text: side },
  ], { currentText: null, lastMaterialised: null, tombstoned: false, registers: soleRegisters(null) })
  expect(plan.action).toBe("capture")
  if (plan.action !== "capture") throw new Error("expected capture")
  const doc = await newDoc("1")
  try {
    // When the plan is committed as real CRDT operations.
    applyPlan(doc, "", plan)
    // Then the committed render, not merely the plan, retains all values.
    assertPreserved([main, other, side], renderDocContent(doc), "existing-key capture")
    expect(renderDocContent(doc)).toBe(plan.rendered)
  } finally {
    doc.free()
  }
})
