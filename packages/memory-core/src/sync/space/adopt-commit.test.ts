import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"
import { withRegisterValues } from "../item/adopt-values"
import { captureItem } from "../item/capture"
import { activeRegisters, captureOnDevice, createDeviceItemDoc, itemFrontier } from "../item/index"
import { renderDocContent } from "../item/render"
import { renderForDisk } from "../item/render-for-disk"
import { activeReg, readKeyState } from "../item/state"
import { captureInto, newDoc, withDevices } from "../item/test-support"
import { planAdoption, type Snapshot } from "./adopt"
import { confirmRemovals } from "./confirm-removals"
import { mergeInsertions } from "./merge"
import { firstMissingFact } from "./read-back"

// Review r7 of #10206 (receipt 907490bd76): sync-design #454 §3 and rule 1. A source may be deleted
// only on a read-back of the COMMITTED item, and the capture plus its extra register values land as
// one update, so no crash point leaves a deleted source whose value the space does not hold.

const SIDE = "n.sync-conflict-20261015-mac.md"
// The device-entry row opens a device (one machine-id probe spawn); bound it as a circuit breaker.
const DEVICE_TIMEOUT_MS = 60_000

async function space(text: string): Promise<{ readonly doc: LoroDoc; readonly base: string }> {
  const doc = await newDoc("1")
  captureInto(doc, "", [], text)
  return { doc, base: renderDocContent(doc) }
}

/** One update (capture + register values) on a plain doc; the device entry point is covered in the H1 row and adopt-replay.test.ts. */
function commitAdoption(doc: LoroDoc, base: string, frontier: ReturnType<typeof itemFrontier>, working: string, values: Parameters<typeof withRegisterValues>[2]) {
  return withRegisterValues(doc, captureItem(doc, base, frontier, working), values)
}

const stateOf = (doc: LoroDoc, base: string) => ({ currentText: base, lastMaterialised: null, tombstoned: false, registers: activeRegisters(doc) })
const active = (doc: LoroDoc, key: string): string[] => activeReg(readKeyState(doc, key).reg).map((entry) => entry.value).sort()

describe("H1: one atomic commit, deletion decided on the committed item", () => {
  const files: readonly Snapshot[] = [{ path: SIDE, text: "---\nd: laptop\n---\nbody\nnew line\n" }]

  test("through the device entry point, the capture and the extra register values are ONE update", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await createDeviceItemDoc(device)
      try {
        const seed = await captureOnDevice(device, "n.md", doc, "", [], "---\nd: space\n---\nbody\n")
        if (seed !== null) doc.import(seed)
        const base = renderDocContent(doc)
        const plan = planAdoption(files, stateOf(doc, base))
        if (plan.action !== "capture") throw new Error("expected capture")
        const update = await captureOnDevice(device, "n.md", doc, base, itemFrontier(doc), plan.workingText, plan.extraRegisterValues)
        expect(update).not.toBeNull()
        if (update !== null) doc.import(update)
        expect(active(doc, "d")).toEqual(["laptop", "space"])
        expect(renderDocContent(doc)).toContain("new line\n")
      } finally {
        doc.free()
      }
    })
  }, DEVICE_TIMEOUT_MS)

  test("a crash after the capture but before the register values keeps the source", async () => {
    const { doc, base } = await space("---\nd: space\n---\nbody\n")
    try {
      const plan = planAdoption(files, stateOf(doc, base))
      if (plan.action !== "capture") throw new Error("expected capture")
      expect(plan.removalCandidates).toEqual([SIDE])
      captureInto(doc, base, itemFrontier(doc), plan.workingText)
      const decision = confirmRemovals(doc, plan, files)
      expect(decision.remove).toEqual([])
      expect(decision.retained).toEqual([{ path: SIDE, reason: 'missing line "d: laptop"' }])
    } finally {
      doc.free()
    }
  })

  test("a plan whose prediction the item never received keeps the source", async () => {
    const { doc, base } = await space("---\nd: space\n---\nbody\n")
    try {
      const plan = planAdoption(files, stateOf(doc, base))
      const decision = confirmRemovals(doc, plan, files)
      expect(decision.remove).toEqual([])
      expect(decision.retained.map((entry) => entry.path)).toEqual([SIDE])
    } finally {
      doc.free()
    }
  })

  test("once the one update is imported, the source is confirmed for removal", async () => {
    const { doc, base } = await space("---\nd: space\n---\nbody\n")
    try {
      const plan = planAdoption(files, stateOf(doc, base))
      if (plan.action !== "capture") throw new Error("expected capture")
      const update = commitAdoption(doc, base, itemFrontier(doc), plan.workingText, plan.extraRegisterValues)
      if (update !== null) doc.import(update)
      expect(confirmRemovals(doc, plan, files)).toEqual({ remove: [SIDE], retained: [] })
    } finally {
      doc.free()
    }
  })
})

describe("the deletion gate reads back BOTH sides of the committed item: its render and its active registers", () => {
  test("registers side: a joined render of the values a and b never vouches for a side's single value \"a / b\"", async () => {
    const { doc, base } = await space("---\nk: x\n---\nx\n")
    try {
      const other = await newDoc("2")
      try {
        other.import(doc.export({ mode: "snapshot" }))
        captureInto(other, base, itemFrontier(other), "---\nk: b\n---\nx\n")
        captureInto(doc, base, itemFrontier(doc), "---\nk: a\n---\nx\n")
        doc.import(other.export({ mode: "update", from: doc.oplogVersion() }))
      } finally {
        other.free()
      }
      const joined = renderDocContent(doc)
      expect(joined).toBe('---\nk: "a / b"\n---\nx\n')
      const files = [{ path: SIDE, text: '---\nk: "a / b"\n---\nx\n' }]
      const plan = planAdoption(files, stateOf(doc, joined))
      // The planner keeps it too; the gate is pinned on its own by handing it the side as a candidate.
      const candidate = { ...plan, removalCandidates: [SIDE], retainedSources: [] }
      expect(confirmRemovals(doc, candidate, files)).toEqual({ remove: [], retained: [{ path: SIDE, reason: 'missing line "k: \\"a / b\\""' }] })
    } finally {
      doc.free()
    }
  })

  test("#10321: a body line under a joined key is text, so a side holding only that line is deleted", async () => {
    const { doc, base } = await space("---\nk: x\n---\nk: zzz\n")
    try {
      const other = await newDoc("2")
      try {
        other.import(doc.export({ mode: "snapshot" }))
        captureInto(other, base, itemFrontier(other), "---\nk: b\n---\nk: zzz\n")
        captureInto(doc, base, itemFrontier(doc), "---\nk: a\n---\nk: zzz\n")
        doc.import(other.export({ mode: "update", from: doc.oplogVersion() }))
      } finally {
        other.free()
      }
      const joined = renderDocContent(doc)
      expect(joined).toBe('---\nk: "a / b"\n---\nk: zzz\n')
      const files = [{ path: SIDE, text: "k: zzz\n" }]
      const plan = planAdoption(files, stateOf(doc, joined))
      expect(plan.removalCandidates).toEqual([SIDE])
      expect(confirmRemovals(doc, plan, files)).toEqual({ remove: [SIDE], retained: [] })
    } finally {
      doc.free()
    }
  })

  test("render side: a body line the committed item does not hold keeps the side, whatever the registers hold", async () => {
    const { doc, base } = await space("---\nd: space\n---\nx\n")
    try {
      const files = [{ path: SIDE, text: "---\nd: space\n---\nx\nonly in the side\n" }]
      const plan = planAdoption(files, stateOf(doc, base))
      const candidate = { ...plan, removalCandidates: [SIDE], retainedSources: [] }
      expect(confirmRemovals(doc, candidate, files)).toEqual({ remove: [], retained: [{ path: SIDE, reason: 'missing line "only in the side"' }] })
    } finally {
      doc.free()
    }
  })
})

describe("M1: the space's register components are required", () => {
  test("a register key missing from the components is refused, never read as one whole value", () => {
    const state = { currentText: '---\nk: "a / b"\n---\n', lastMaterialised: null, tombstoned: false, registers: new Map() }
    expect(() => planAdoption([], state)).toThrow('planAdoption: ItemState.registers has no components for register key "k"')
  })

  test("a side's single value \"a / b\" over the two values a and b is adopted as its own entry", async () => {
    const { doc, base } = await space("---\nk: x\n---\nx\n")
    try {
      const other = await newDoc("2")
      try {
        other.import(doc.export({ mode: "snapshot" }))
        captureInto(other, base, itemFrontier(other), "---\nk: b\n---\nx\n")
        captureInto(doc, base, itemFrontier(doc), "---\nk: a\n---\nx\n")
        doc.import(other.export({ mode: "update", from: doc.oplogVersion() }))
      } finally {
        other.free()
      }
      expect(active(doc, "k")).toEqual(["a", "b"])
      const joined = renderDocContent(doc)
      const files = [{ path: SIDE, text: '---\nk: "a / b"\n---\nx\n' }]
      const plan = planAdoption(files, stateOf(doc, joined))
      if (plan.action !== "capture") throw new Error("expected capture")
      const update = commitAdoption(doc, joined, itemFrontier(doc), plan.workingText, plan.extraRegisterValues)
      if (update !== null) doc.import(update)
      expect(active(doc, "k")).toEqual(["a", "a / b", "b"])
      expect(confirmRemovals(doc, plan, files).remove).toEqual([SIDE])
    } finally {
      doc.free()
    }
  })
})

describe("M2: a leading UTF-8 BOM", () => {
  test("a main file with a BOM keeps one header and no BOM in the item", async () => {
    const { doc, base } = await space("---\ntitle: A\n---\nbody\n")
    try {
      const plan = planAdoption([{ path: "n.md", text: "\uFEFF---\ntitle: A\n---\nbody\n" }], stateOf(doc, base))
      expect(plan.action).toBe("none")
      expect(plan.rendered).toBe("---\ntitle: A\n---\nbody\n")
    } finally {
      doc.free()
    }
  })

  test("a side file with a BOM is adopted by its keys and confirmed for removal", async () => {
    const { doc, base } = await space("---\ntitle: A\n---\nbody\n")
    try {
      const files = [{ path: SIDE, text: "\uFEFF---\ntitle: B\n---\nbody\n" }]
      const plan = planAdoption(files, stateOf(doc, base))
      if (plan.action !== "capture") throw new Error("expected capture")
      expect(plan.extraRegisterValues).toEqual([{ key: "title", value: "B" }])
      const update = commitAdoption(doc, base, itemFrontier(doc), plan.workingText, plan.extraRegisterValues)
      if (update !== null) doc.import(update)
      expect(active(doc, "title")).toEqual(["A", "B"])
      expect(renderDocContent(doc).includes("\uFEFF")).toBe(false)
      expect(confirmRemovals(doc, plan, files).remove).toEqual([SIDE])
    } finally {
      doc.free()
    }
  })
})

test("M2 end to end: a BOM main and a BOM side are adopted, and the main is written back with its BOM", async () => {
  const { doc, base } = await space("---\ntitle: A\n---\nbody\n")
  try {
    const main = "\uFEFF---\ntitle: A\n---\nbody\n"
    const files = [{ path: "n.md", text: main }, { path: SIDE, text: "\uFEFF---\ntitle: B\n---\nbody\n" }]
    const plan = planAdoption(files, stateOf(doc, base))
    if (plan.action !== "capture") throw new Error("expected capture")
    const update = commitAdoption(doc, base, itemFrontier(doc), plan.workingText, plan.extraRegisterValues)
    if (update !== null) doc.import(update)
    expect(renderForDisk(doc, main)).toBe('\uFEFF---\ntitle: "A / B"\n---\nbody\n')
  } finally {
    doc.free()
  }
})

describe("L1: the two header fences are allowed only when the source has a header", () => {
  test("a file with two horizontal rules and no header keeps both rules or stays on disk", () => {
    expect(firstMissingFact("x\nsection\n", "x\n---\nsection\n---\n", new Map())).toBe(
      'missing line "---" (2 dropped, 0 allowed as metadata)',
    )
  })

  test("a lossy merge that drops the rules keeps the source", async () => {
    const { doc, base } = await space("x\n")
    try {
      const dropRules = (into: string, incoming: string): string => mergeInsertions(into, incoming.replace(/^---\n/gm, ""))
      const files = [{ path: SIDE, text: "x\n---\nsection\n---\n" }]
      const plan = planAdoption(files, stateOf(doc, base), dropRules)
      expect(plan.removalCandidates).toEqual([])
      expect(plan.retainedSources.map((entry) => entry.path)).toEqual([SIDE])
    } finally {
      doc.free()
    }
  })
})
