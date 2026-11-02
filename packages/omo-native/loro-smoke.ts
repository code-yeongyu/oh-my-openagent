// `omo loro-smoke` self-checks that the pinned Loro runtime initializes inside this compiled
// binary and still reproduces the committed wire encodings. The import literal pulls the
// memory-core loader - and with it the embedded loro wasm - into the compiled graph.
import { LORO_GOLDEN_SHALLOW_SNAPSHOT_HEX, LORO_GOLDEN_UPDATE_HEX } from "../memory-core/src/crdt/loro-fixture"

const LORO_SMOKE_UPDATE_HEX = LORO_GOLDEN_UPDATE_HEX
const LORO_SMOKE_SHALLOW_HEX = LORO_GOLDEN_SHALLOW_SNAPSHOT_HEX

function hexOf(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex")
}

export async function runLoroSmoke(): Promise<number> {
  const { loadLoroRuntime } = await import("../memory-core/src/crdt/loro-runtime")
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
    if (doc.getText("body").toString() !== "hallo") throw new Error("edit sequence did not render hallo")
    const updateHex = hexOf(doc.export({ mode: "update" }))
    const shallowHex = hexOf(doc.export({ mode: "shallow-snapshot", frontiers: doc.oplogFrontiers() }))
    if (updateHex !== LORO_SMOKE_UPDATE_HEX) throw new Error("update encoding drifted from the committed fixture")
    if (shallowHex !== LORO_SMOKE_SHALLOW_HEX) throw new Error("shallow-snapshot encoding drifted from the committed fixture")
  } finally {
    doc.free()
  }
  console.log(`loro-smoke ok: runtime initialized, edits applied, encodings match loro-crdt 1.16.4 (${LORO_SMOKE_UPDATE_HEX.length / 2}-byte update, ${LORO_SMOKE_SHALLOW_HEX.length / 2}-byte shallow snapshot)`)
  return 0
}
