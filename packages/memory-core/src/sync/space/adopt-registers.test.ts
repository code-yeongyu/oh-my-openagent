import { describe, expect, test } from "bun:test"

import { splitItem } from "../item/frontmatter"
import { activeRegisters } from "../item/index"
import { renderDocContent } from "../item/render"
import { activeReg, readKeyState } from "../item/state"
import { captureInto, newDoc } from "../item/test-support"
import { planAdoption } from "./adopt"
import { firstMissingFact } from "./read-back"
import { applyPlan, t2Block, soleRegisters } from "./test-support"

// sync-design #454 §3 "Insert-only adoption" and §10 (no marker or conflict text in the user's
// file). Every expectation is written from the spec, not read back from the planner.

const SIDE = "n.sync-conflict-20261015-mac.md"

async function spaceWith(text: string) {
  const doc = await newDoc("1")
  captureInto(doc, "", [], text)
  const base = renderDocContent(doc)
  return { doc, base, state: { currentText: base, lastMaterialised: null, tombstoned: false, registers: activeRegisters(doc) } }
}

const activeValues = (doc: Parameters<typeof readKeyState>[0], key: string): string[] =>
  activeReg(readKeyState(doc, key).reg).map((entry) => entry.value).sort()

const hasMarker = (text: string): boolean => text.split("\n").some((line) => line.startsWith("<!-- memory-sync"))

describe("(a) a differing register value is one more entry superseding nothing", () => {
  test("a side file's description beside the space's: both whole values active, one double-quoted render, no marker", async () => {
    const { doc, base, state } = await spaceWith("---\ndescription: space view\n---\nbody\n")
    try {
      const plan = planAdoption([{ path: SIDE, text: "---\ndescription: laptop view\n---\nbody\n" }], state)
      expect(plan.action).toBe("capture")
      if (plan.action !== "capture") return
      expect(hasMarker(plan.workingText)).toBe(false)
      applyPlan(doc, base, plan)
      expect(activeValues(doc, "description")).toEqual(["laptop view", "space view"])
      expect(renderDocContent(doc)).toBe('---\ndescription: "laptop view / space view"\n---\nbody\n')
      expect(plan.removalCandidates).toEqual([SIDE])
    } finally {
      doc.free()
    }
  })

  test("typed values stay distinct whole values: 3 and '3', two mappings", async () => {
    const { doc, base, state } = await spaceWith("---\nn: 3\nm: {a: 1}\n---\nx\n")
    try {
      const plan = planAdoption([{ path: SIDE, text: "---\nn: '3'\nm: {a: 2}\n---\nx\n" }], state)
      applyPlan(doc, base, plan)
      expect(activeValues(doc, "n")).toEqual(['"3"', "3"])
      expect(activeValues(doc, "m")).toEqual(["{ a: 1 }", "{ a: 2 }"])
      expect(hasMarker(renderDocContent(doc))).toBe(false)
      expect(plan.removalCandidates).toEqual([SIDE])
    } finally {
      doc.free()
    }
  })

  test("a T2 block's differing value joins the same way, and the block leaves the body", async () => {
    const doc = await newDoc("1")
    try {
      const main = `---\ntitle: Main\n---\nmain\n${t2Block("2026-10-15", "n.md", "---\ntitle: Other\n---\n")}`
      const plan = planAdoption([{ path: "n.md", text: main }, { path: SIDE, text: "---\ntitle: Side\n---\nmain\n" }], {
        currentText: null,
        lastMaterialised: null,
        tombstoned: false,
        registers: soleRegisters(null)
      })
      applyPlan(doc, "", plan)
      expect(activeValues(doc, "title")).toEqual(["Main", "Other", "Side"])
      expect(renderDocContent(doc)).toBe('---\ntitle: "Main / Other / Side"\n---\nmain\n')
    } finally {
      doc.free()
    }
  })

  test("adopting the same files again over the result adds nothing", async () => {
    const { doc, base, state } = await spaceWith("---\ndescription: space view\n---\nbody\n")
    try {
      const files = [{ path: SIDE, text: "---\ndescription: laptop view\n---\nbody\n" }]
      applyPlan(doc, base, planAdoption(files, state))
      const again = renderDocContent(doc)
      const repeated = planAdoption(files, { currentText: again, lastMaterialised: null, tombstoned: false, registers: activeRegisters(doc) })
      expect(repeated.action).toBe("none")
    } finally {
      doc.free()
    }
  })
})

test("(b) a list key adopts the union of its elements", async () => {
  const { doc, base, state } = await spaceWith("---\ntags: [a, b]\n---\nx\n")
  try {
    const plan = planAdoption([{ path: SIDE, text: "---\ntags: [b, c]\n---\nx\n" }], state)
    applyPlan(doc, base, plan)
    const tags = splitItem(renderDocContent(doc)).fm?.find((entry) => entry.key === "tags")?.value
    expect(tags?.kind === "set" ? [...tags.elements].sort() : tags).toEqual(["a", "b", "c"])
    expect(plan.removalCandidates).toEqual([SIDE])
  } finally {
    doc.free()
  }
})

test("(c) the body keeps insert-only line adoption: nothing the space holds is deleted", async () => {
  const { doc, base, state } = await spaceWith("x\ny\n")
  try {
    const plan = planAdoption([{ path: SIDE, text: "x\nz\n" }], state)
    applyPlan(doc, base, plan)
    expect(splitItem(renderDocContent(doc)).body.split("\n").filter((line) => line !== "").sort()).toEqual(["x", "y", "z"])
  } finally {
    doc.free()
  }
})

describe("(d) the structure-free read-back accounts a register line only by an active entry", () => {
  const joined = '---\nk: "v / w"\n---\nx\n'

  test("a source value that is an active entry is accounted for", () => {
    expect(firstMissingFact(joined, "---\nk: w\n---\nx\n", new Map([["k", ["v", "w"]]]))).toBeNull()
  })

  test("a joined render alone never vouches for a component", () => {
    expect(firstMissingFact(joined, "---\nk: w\n---\nx\n", new Map())).toBe('missing line "k: w"')
  })

  test("a value that is not an active entry keeps the source with the reason", () => {
    expect(firstMissingFact("---\nk: v\n---\nx\n", "---\nk: w\n---\nx\n", new Map([["k", ["v"]]]))).toBe('missing line "k: w"')
  })
})
