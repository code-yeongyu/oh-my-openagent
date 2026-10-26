import { describe, expect, test } from "bun:test"

import type { LoroDoc } from "../../crdt/loro-runtime"
import type { ItemDevice } from "../item/device"
import { readReceipts, sameFrontier } from "../item/capture-receipts"
import { activeRegisters, captureOnDevice, createDeviceItemDoc, itemFrontier } from "../item/index"
import { renderDocContent } from "../item/render"
import { activeReg, readKeyState } from "../item/state"
import { withDevices } from "../item/test-support"
import { planAdoption, type Snapshot } from "./adopt"
import { confirmRemovals } from "./confirm-removals"

// Review r8 of #10206 (receipt 097ab36d2f, M1): adoption goes through the one guarded capture entry
// point, so replaying it from the same stale baseline, before or after a crash, applies the edit once.

const SIDE = "n.sync-conflict-20261015-mac.md"
// Opening a device spawns the platform machine-id probe once per process; under host load that alone
// can pass bun's 5 s default. This bound is a circuit breaker, not a wait.
const DEVICE_TIMEOUT_MS = 60_000
const active = (doc: LoroDoc, key: string): string[] => activeReg(readKeyState(doc, key).reg).map((entry) => entry.value).sort()

async function adopt(device: ItemDevice, doc: LoroDoc, base: string, frontier: ReturnType<typeof itemFrontier>, files: readonly Snapshot[]) {
  const plan = planAdoption(files, { currentText: base, lastMaterialised: null, tombstoned: false, registers: activeRegisters(doc) })
  if (plan.action !== "capture") throw new Error(`expected capture, got ${plan.action}`)
  const update = await captureOnDevice(device, "n.md", doc, base, frontier, plan.workingText, plan.extraRegisterValues)
  return { plan, update }
}

describe("M1: adoption replays through the guarded capture entry point", () => {
  const files: readonly Snapshot[] = [{ path: SIDE, text: "---\nd: laptop\n---\nx\ny\n" }]

  test("replaying the same adoption from the same stale baseline applies it once", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await createDeviceItemDoc(device)
      try {
        const seed = await captureOnDevice(device, "n.md", doc, "", [], "---\nd: space\n---\nx\n")
        if (seed !== null) doc.import(seed)
        const base = renderDocContent(doc)
        const f0 = itemFrontier(doc)
        const first = await adopt(device, doc, base, f0, files)
        if (first.update !== null) doc.import(first.update)
        const once = renderDocContent(doc)
        expect(once).toBe('---\nd: "laptop / space"\n---\nx\ny\n')
        const replay = await captureOnDevice(device, "n.md", doc, base, f0, first.plan.workingText, first.plan.extraRegisterValues)
        if (replay !== null) doc.import(replay)
        expect(renderDocContent(doc)).toBe(once)
        expect(active(doc, "d")).toEqual(["laptop", "space"])
        expect(confirmRemovals(doc, first.plan, files).remove).toEqual([SIDE])
      } finally {
        doc.free()
      }
    })
  }, DEVICE_TIMEOUT_MS)

  test("a crash after the receipt but before the import re-captures once, never twice", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await createDeviceItemDoc(device)
      try {
        const seed = await captureOnDevice(device, "n.md", doc, "", [], "---\nd: space\n---\nx\n")
        if (seed !== null) doc.import(seed)
        const base = renderDocContent(doc)
        const f0 = itemFrontier(doc)
        const lost = await adopt(device, doc, base, f0, files)
        expect(lost.update).not.toBeNull()
        const again = await adopt(device, doc, base, f0, files)
        if (again.update !== null) doc.import(again.update)
        const third = await captureOnDevice(device, "n.md", doc, base, f0, again.plan.workingText, again.plan.extraRegisterValues)
        if (third !== null) doc.import(third)
        expect(renderDocContent(doc)).toBe('---\nd: "laptop / space"\n---\nx\ny\n')
      } finally {
        doc.free()
      }
    })
  }, DEVICE_TIMEOUT_MS)

  test("a replay never brings back a register value a peer already replaced (older never overwrites newer)", async () => {
    await withDevices(2, async ([device, peer]) => {
      if (device === undefined || peer === undefined) throw new Error("no devices")
      const doc = await createDeviceItemDoc(device)
      const other = await createDeviceItemDoc(peer)
      try {
        const seed = await captureOnDevice(device, "n.md", doc, "", [], "---\nd: space\n---\nx\n")
        if (seed !== null) doc.import(seed)
        const base = renderDocContent(doc)
        const f0 = itemFrontier(doc)
        const only: readonly Snapshot[] = [{ path: SIDE, text: "---\nd: laptop\n---\nx\n" }]
        const first = await adopt(device, doc, base, f0, only)
        if (first.update !== null) doc.import(first.update)
        other.import(doc.export({ mode: "snapshot" }))
        const seen = renderDocContent(other)
        const replaced = await captureOnDevice(peer, "n.md", other, seen, itemFrontier(other), "---\nd: z\n---\nx\n")
        if (replaced !== null) doc.import(replaced)
        expect(active(doc, "d")).toEqual(["z"])
        const replay = await captureOnDevice(device, "n.md", doc, base, f0, first.plan.workingText, first.plan.extraRegisterValues)
        if (replay !== null) doc.import(replay)
        expect(active(doc, "d")).toEqual(["z"])
        expect(renderDocContent(doc)).toBe("---\nd: z\n---\nx\n")
      } finally {
        doc.free()
        other.free()
      }
    })
  }, DEVICE_TIMEOUT_MS)

  test("write rule: a superseded value is already written, so an unchanged capture writes nothing and still receipts its baseline", async () => {
    await withDevices(2, async ([device, peer]) => {
      if (device === undefined || peer === undefined) throw new Error("no devices")
      const doc = await createDeviceItemDoc(device)
      const other = await createDeviceItemDoc(peer)
      try {
        const seed = await captureOnDevice(device, "n.md", doc, "", [], "---\nd: space\n---\nx\n")
        if (seed !== null) doc.import(seed)
        const only: readonly Snapshot[] = [{ path: SIDE, text: "---\nd: laptop\n---\nx\n" }]
        const first = await adopt(device, doc, renderDocContent(doc), itemFrontier(doc), only)
        if (first.update !== null) doc.import(first.update)
        other.import(doc.export({ mode: "snapshot" }))
        const replaced = await captureOnDevice(peer, "n.md", other, renderDocContent(other), itemFrontier(other), "---\nd: z\n---\nx\n")
        if (replaced !== null) doc.import(replaced)
        const now = renderDocContent(doc)
        const frontier = itemFrontier(doc)
        const versionBefore = doc.oplogVersion()
        const update = await captureOnDevice(device, "n.md", doc, now, frontier, now, [{ key: "d", value: "laptop" }])
        expect(update).toBeNull()
        expect(doc.oplogVersion().compare(versionBefore)).toBe(0)
        const receipts = await readReceipts(device.stateDir, "n.md")
        expect(receipts.some((r) => sameFrontier(r.base, frontier) && r.text === now)).toBe(true)
      } finally {
        doc.free()
        other.free()
      }
    })
  }, DEVICE_TIMEOUT_MS)

  test("read rule: a superseded value is not held, so the deletion gate keeps the side that carries it", async () => {
    await withDevices(2, async ([device, peer]) => {
      if (device === undefined || peer === undefined) throw new Error("no devices")
      const doc = await createDeviceItemDoc(device)
      const other = await createDeviceItemDoc(peer)
      try {
        const seed = await captureOnDevice(device, "n.md", doc, "", [], "---\nd: space\n---\nx\n")
        if (seed !== null) doc.import(seed)
        const only: readonly Snapshot[] = [{ path: SIDE, text: "---\nd: laptop\n---\nx\n" }]
        const first = await adopt(device, doc, renderDocContent(doc), itemFrontier(doc), only)
        if (first.update !== null) doc.import(first.update)
        other.import(doc.export({ mode: "snapshot" }))
        const replaced = await captureOnDevice(peer, "n.md", other, renderDocContent(other), itemFrontier(other), "---\nd: z\n---\nx\n")
        if (replaced !== null) doc.import(replaced)
        expect(confirmRemovals(doc, first.plan, only)).toEqual({ remove: [], retained: [{ path: SIDE, reason: 'missing line "d: laptop"' }] })
      } finally {
        doc.free()
        other.free()
      }
    })
  }, DEVICE_TIMEOUT_MS)

  test("register values alone, over an unchanged body, still land through the entry point", async () => {
    await withDevices(1, async ([device]) => {
      if (device === undefined) throw new Error("no device")
      const doc = await createDeviceItemDoc(device)
      try {
        const seed = await captureOnDevice(device, "n.md", doc, "", [], "---\nd: space\n---\nx\n")
        if (seed !== null) doc.import(seed)
        const base = renderDocContent(doc)
        const only: readonly Snapshot[] = [{ path: SIDE, text: "---\nd: laptop\n---\nx\n" }]
        const { plan, update } = await adopt(device, doc, base, itemFrontier(doc), only)
        expect(plan.workingText).toBe(base)
        if (update !== null) doc.import(update)
        expect(active(doc, "d")).toEqual(["laptop", "space"])
        expect(confirmRemovals(doc, plan, only).remove).toEqual([SIDE])
      } finally {
        doc.free()
      }
    })
  }, DEVICE_TIMEOUT_MS)
})
