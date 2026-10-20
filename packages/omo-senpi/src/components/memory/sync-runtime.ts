import { caseFold, loadLoroRuntime } from "@oh-my-opencode/memory-core/sync-engine"

export { openDeviceSync } from "@oh-my-opencode/memory-core/sync-engine"

/** Proves the packaged sidecar's file assets load: the Loro wasm and the case-fold table beside it. */
export async function checkSyncRuntime(): Promise<void> {
  const { LoroDoc } = await loadLoroRuntime()
  const doc = new LoroDoc()
  try {
    doc.getText("t").insert(0, "hi")
    doc.commit()
  } finally {
    doc.free()
  }
  if (caseFold("Straße") !== "strasse") throw new Error("memory sync: the case-fold table did not load")
}
