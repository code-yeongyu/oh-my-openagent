import { describe, expect, test } from "bun:test"
import { LORO_GOLDEN_SHALLOW_SNAPSHOT_HEX, LORO_GOLDEN_UPDATE_HEX } from "./loro-fixture"
import { loadLoroRuntime } from "./loro-runtime"

const updateHex = LORO_GOLDEN_UPDATE_HEX
const shallowSnapshotHex = LORO_GOLDEN_SHALLOW_SNAPSHOT_HEX

describe("Loro runtime glue parity", () => {
  test("subscribe and subscribeLocalUpdates each deliver exactly one event batch after insert + commit", async () => {
    const { LoroDoc } = await loadLoroRuntime()
    const doc = new LoroDoc()
    try {
      const batches: string[] = []
      const localUpdates: string[] = []
      const unsubscribe = doc.subscribe(() => batches.push("batch"))
      const unsubscribeLocal = doc.subscribeLocalUpdates(() => localUpdates.push("bytes"))
      doc.getText("body").insert(0, "hello")
      doc.commit()
      expect(batches.length, "subscribe listener firings after one commit").toBe(1)
      expect(localUpdates.length, "subscribeLocalUpdates listener firings after one commit").toBe(1)
      unsubscribe()
      unsubscribeLocal()
    } finally {
      doc.free()
    }
  })

  test("toJsonWithReplacer exists on a doc from the runtime", async () => {
    const { LoroDoc } = await loadLoroRuntime()
    const doc = new LoroDoc()
    try {
      expect(typeof doc.toJsonWithReplacer).toBe("function")
    } finally {
      doc.free()
    }
  })
})

describe("Loro encoding pin", () => {
  test("fixed operations preserve update and shallow-snapshot golden bytes", async () => {
    const { LoroDoc } = await loadLoroRuntime()
    const doc = new LoroDoc()
    try {
      doc.setPeerId("7")
      doc.setRecordTimestamp(false)
      doc.getText("body").insert(0, "hello")
      doc.commit({ timestamp: 0 })
      doc.getText("body").delete(1, 1)
      doc.getText("body").insert(1, "a")
      doc.commit({ timestamp: 0 })

      expect(doc.getText("body").toString()).toBe("hallo")
      expect(Buffer.from(doc.export({ mode: "update" })).toString("hex"), "update fixture drift").toBe(updateHex)
      expect(Buffer.from(doc.export({
        mode: "shallow-snapshot",
        frontiers: doc.oplogFrontiers(),
      })).toString("hex"), "shallow-snapshot fixture drift").toBe(shallowSnapshotHex)

      for (const hex of [updateHex, shallowSnapshotHex]) {
        const restored = new LoroDoc()
        try {
          restored.import(Buffer.from(hex, "hex"))
          expect(restored.getText("body").toString()).toBe("hallo")
        } finally {
          restored.free()
        }
      }
    } finally {
      doc.free()
    }
  })
})
